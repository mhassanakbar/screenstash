import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rename,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { limits } from '@screenstash/shared';
import {
  LocalOcrRecognizer,
  OfflineOcr,
  normalizeOcrText,
  ocrResourceDirectory,
} from '../../apps/desktop/src/main/ocr';

const services: OfflineOcr[] = [];
const directories: string[] = [];
const resourceDirectory = path.resolve('apps/desktop/resources/ocr');
const png = () =>
  sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
interface Packet {
  jobId: string;
  action: string;
}
class FakeWorker extends EventEmitter {
  packets: Packet[] = [];
  terminated = 0;
  hang: string | null = null;
  crash: string | null = null;
  text = 'Useful OCR text!';
  postMessage(packet: Packet) {
    this.packets.push(packet);
    if (packet.action === this.hang) return;
    queueMicrotask(() => {
      if (packet.action === this.crash)
        this.emit('error', new Error('private screenshot text'));
      else
        this.emit('message', {
          jobId: packet.jobId,
          status: 'resolve',
          data: packet.action === 'recognize' ? { text: this.text } : {},
        });
    });
  }
  async terminate() {
    this.terminated += 1;
    return 0;
  }
}
function service(
  workers: FakeWorker[],
  options: { timeoutMs?: number; maxTasksPerWorker?: number } = {},
) {
  const created: FakeWorker[] = [];
  const ocr = new OfflineOcr({
    resourceDirectory,
    ...options,
    createWorker: () => {
      const worker = workers[created.length]!;
      created.push(worker);
      return worker;
    },
  });
  services.push(ocr);
  return { ocr, created };
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((ocr) => ocr.stop()));
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('screenstash-ocr-')
    )
      throw new Error('Unexpected OCR cleanup target');
    await rm(directory, { force: true, recursive: true });
  }
});

describe('Offline OCR lifecycle', () => {
  it('resolves development and unpacked installed resources explicitly', () => {
    expect(
      ocrResourceDirectory({
        isPackaged: false,
        appPath: 'development',
        resourcesPath: 'installed',
      }),
    ).toBe(path.join('development', 'resources', 'ocr'));
    expect(
      ocrResourceDirectory({
        isPackaged: true,
        appPath: 'application.asar',
        resourcesPath: 'installed',
      }),
    ).toBe(path.join('installed', 'ocr'));
    expect(
      () => new OfflineOcr({ resourceDirectory: 'https://invalid.test' }),
    ).toThrow();
  });
  it('normalizes controls while preserving punctuation, paragraphs and Unicode boundaries', () => {
    expect(
      normalizeOcrText(
        '  Invoice:\t 123.45!\r\n\u0000Line\u202e two\n\n\nFinal.  ',
      ),
    ).toEqual({
      ocrText: 'Invoice: 123.45!\nLine two\n\nFinal.',
      truncated: false,
    });
    const result = normalizeOcrText('a'.repeat(limits.ocrText - 1) + '😀tail');
    expect(result.truncated).toBe(true);
    expect(result.ocrText).toBe('a'.repeat(limits.ocrText - 1));
  });
  it('reuses one initialized worker and limits the worker lifetime', async () => {
    const first = new FakeWorker(),
      second = new FakeWorker();
    const { ocr, created } = service([first, second], { maxTasksPerWorker: 2 });
    const bytes = await png();
    expect((await ocr.recognize(bytes)).ocrStatus).toBe('succeeded');
    expect((await ocr.recognize(bytes)).ocrStatus).toBe('succeeded');
    expect(first.packets.map((packet) => packet.action)).toEqual([
      'load',
      'loadLanguage',
      'initialize',
      'recognize',
      'recognize',
    ]);
    expect(first.terminated).toBe(1);
    await ocr.recognize(bytes);
    expect(created).toHaveLength(2);
  });
  it.each(['load', 'loadLanguage', 'initialize', 'recognize'])(
    'times out %s and recreates the worker on the next task',
    async (action) => {
      const first = new FakeWorker(),
        second = new FakeWorker();
      first.hang = action;
      const { ocr } = service([first, second], { timeoutMs: 30 });
      const bytes = await png();
      expect(await ocr.recognize(bytes)).toEqual({
        ocrStatus: 'failed',
        ocrText: '',
        ocrError: 'timeout',
        truncated: false,
      });
      expect(first.terminated).toBe(1);
      expect((await ocr.recognize(bytes)).ocrStatus).toBe('succeeded');
    },
  );
  it('sanitizes crashes and recovers without leaking worker errors', async () => {
    const first = new FakeWorker(),
      second = new FakeWorker();
    first.crash = 'recognize';
    const { ocr } = service([first, second]);
    const adapter = new LocalOcrRecognizer(ocr);
    const bytes = await png();
    await expect(adapter.recognize(bytes)).rejects.toThrow('worker_failed');
    expect(await adapter.recognize(bytes)).toEqual({
      text: 'Useful OCR text!',
      truncated: false,
    });
    await adapter.terminate();
  });
  it('kills an actual CPU-bound thread on timeout before accepting another task', async () => {
    let created = 0;
    let retired = false;
    const ocr = new OfflineOcr({
      resourceDirectory,
      timeoutMs: 100,
      createWorker: () => {
        created += 1;
        if (created > 1) {
          expect(retired).toBe(true);
          return new FakeWorker();
        }
        const thread = new Worker('while (true) {}', { eval: true });
        thread.on('exit', () => {
          retired = true;
        });
        return thread;
      },
    });
    services.push(ocr);
    const bytes = await png();
    expect((await ocr.recognize(bytes)).ocrError).toBe('timeout');
    expect(retired).toBe(true);
    expect((await ocr.recognize(bytes)).ocrStatus).toBe('succeeded');
  });
  it('rejects concurrent tasks and stop aborts initialization immediately', async () => {
    const worker = new FakeWorker();
    worker.hang = 'load';
    const { ocr } = service([worker]);
    const bytes = await png();
    const active = ocr.recognize(bytes);
    expect((await ocr.recognize(bytes)).ocrError).toBe('busy');
    await ocr.stop();
    expect((await active).ocrError).toBe('stopped');
    expect((await ocr.recognize(bytes)).ocrError).toBe('stopped');
    expect(worker.terminated).toBe(1);
  });
  it('rejects invalid and oversized images before starting a worker', async () => {
    const { ocr, created } = service([]);
    expect(
      (await ocr.recognize(Buffer.from('https://invalid.test/image.png')))
        .ocrError,
    ).toBe('invalid_image');
    const bytes = await png();
    bytes.writeUInt32BE(limits.imageSide + 1, 16);
    expect((await ocr.recognize(bytes)).ocrError).toBe('invalid_image');
    bytes.writeUInt32BE(8000, 16);
    bytes.writeUInt32BE(5001, 20);
    expect((await ocr.recognize(bytes)).ocrError).toBe('invalid_image');
    expect(created).toHaveLength(0);
  });
});

describe('Real offline English recognition', () => {
  it('recognizes from a relocated resource bundle with networking blocked and no writable cache', async () => {
    await promisify(execFile)(process.execPath, [
      'scripts/prepare-desktop-ocr.mjs',
    ]);
    const directory = await mkdtemp(
      path.join(path.resolve(tmpdir()), 'screenstash-ocr-'),
    );
    directories.push(directory);
    const bundled = path.join(directory, 'installed resources', 'ocr');
    await cp(resourceDirectory, bundled, { recursive: true });
    const manifest = JSON.parse(
      await readFile(path.join(bundled, 'manifest.json'), 'utf8'),
    ) as { files: Record<string, string> };
    for (const [filename, checksum] of Object.entries(manifest.files)) {
      expect(
        createHash('sha256')
          .update(await readFile(path.join(bundled, filename)))
          .digest('hex'),
      ).toBe(checksum);
    }
    const guard = path.join(directory, 'no-network.cjs');
    await writeFile(
      guard,
      "const deny = () => { throw Error('Offline OCR attempted network access'); }; globalThis.fetch = deny; for (const name of ['http', 'https']) { const transport = require('node:' + name); transport.request = deny; transport.get = deny; } const net = require('node:net'); net.connect = deny; net.createConnection = deny; require('node:tls').connect = deny;",
    );
    let workers = 0;
    const ocr = new OfflineOcr({
      resourceDirectory: bundled,
      createWorker: (filename) => {
        workers += 1;
        return new Worker(filename, {
          execArgv: ['--require', guard],
          env: { ...process.env, NODE_PATH: '' },
          stdout: true,
          stderr: true,
        });
      },
    });
    services.push(ocr);
    const bytes = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240"><rect width="1200" height="240" fill="white"/><g fill="black" font-family="Arial" font-size="52"><text x="40" y="90">ScreenStash offline OCR</text><text x="40" y="175">Invoice total 123.45</text></g></svg>',
      ),
    )
      .png()
      .toBuffer();
    const adapter = new LocalOcrRecognizer(ocr);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await adapter.recognize(bytes);
      expect(result.text).toMatch(/ScreenStash offline OCR/i);
      expect(result.text).toMatch(/Invoice total 123\.45/i);
      expect(result.truncated).toBe(false);
    }
    expect(workers).toBe(1);
    await adapter.terminate();
    expect(await readdir(path.join(bundled, 'lang'))).toEqual([
      'eng.traineddata.gz',
      'package.json',
    ]);
    const model = path.join(bundled, 'lang', 'eng.traineddata.gz');
    await rename(model, model + '.missing');
    const unavailable = new OfflineOcr({
      resourceDirectory: bundled,
      createWorker: (filename) =>
        new Worker(filename, {
          execArgv: ['--require', guard],
          stdout: true,
          stderr: true,
        }),
    });
    services.push(unavailable);
    expect(await unavailable.recognize(bytes)).toEqual({
      ocrStatus: 'failed',
      ocrText: '',
      ocrError: 'recognition_failed',
      truncated: false,
    });
    await rename(model + '.missing', model);
    expect((await unavailable.recognize(bytes)).ocrStatus).toBe('succeeded');
    await unavailable.stop();
    expect(await readdir(directory)).toEqual([
      'installed resources',
      'no-network.cjs',
    ]);
    await mkdir(path.join(directory, 'missing'), { recursive: true });
    const missing = new OfflineOcr({
      resourceDirectory: path.join(directory, 'missing'),
    });
    services.push(missing);
    expect((await missing.recognize(bytes)).ocrStatus).toBe('failed');
  }, 60_000);
});
