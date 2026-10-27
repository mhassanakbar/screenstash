import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { limits } from '@screenstash/shared';

export type OcrError =
  | 'timeout'
  | 'worker_failed'
  | 'recognition_failed'
  | 'invalid_image'
  | 'busy'
  | 'stopped';
export type OcrResult =
  | {
      ocrStatus: 'succeeded';
      ocrText: string;
      ocrError: null;
      truncated: boolean;
    }
  | { ocrStatus: 'failed'; ocrText: ''; ocrError: OcrError; truncated: false };

export function ocrResourceDirectory(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, 'ocr')
    : path.join(options.appPath, 'resources', 'ocr');
}

export function normalizeOcrText(text: string): {
  ocrText: string;
  truncated: boolean;
} {
  const normalized = text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cc}\p{Cf}]/gu, (character) =>
      character === '\n' || character === '\t' ? character : '',
    )
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  let ocrText = normalized.slice(0, limits.ocrText);
  if (/[\uD800-\uDBFF]$/.test(ocrText)) ocrText = ocrText.slice(0, -1);
  return { ocrText, truncated: normalized.length > ocrText.length };
}

export interface OcrWorker {
  postMessage(packet: unknown): void;
  on(event: 'message', listener: (packet: WorkerResponse) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  terminate(): Promise<number>;
}
interface WorkerResponse {
  jobId: string;
  status: string;
  data?: { text?: string };
}
interface PendingJob {
  id: string;
  resolve: (data: { text?: string }) => void;
  reject: (error: Error) => void;
}
export class OcrFailure extends Error {
  constructor(readonly code: OcrError) {
    super(code);
  }
}
const failure = (ocrError: OcrError): OcrResult => ({
  ocrStatus: 'failed',
  ocrText: '',
  ocrError,
  truncated: false,
});
function validPng(bytes: Uint8Array): boolean {
  if (bytes.length < 33 || bytes.length > limits.uploadBytes) return false;
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, 24);
  if (
    header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    header.readUInt32BE(8) !== 13 ||
    header.toString('ascii', 12, 16) !== 'IHDR'
  )
    return false;
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  return (
    width > 0 &&
    height > 0 &&
    width <= limits.imageSide &&
    height <= limits.imageSide &&
    width * height <= limits.imagePixels
  );
}
export class OfflineOcr {
  private worker: OcrWorker | null = null;
  private pending: PendingJob | null = null;
  private initialized = false;
  private active = false;
  private stopped = false;
  private jobId = 0;
  private completed = 0;
  private stopping: Promise<void> | null = null;
  private retiring: Promise<void> = Promise.resolve();
  private readonly timeoutMs: number;
  private readonly maxTasksPerWorker: number;
  private readonly createWorker: (filename: string) => OcrWorker;

  constructor(
    private readonly options: {
      resourceDirectory: string;
      timeoutMs?: number;
      maxTasksPerWorker?: number;
      createWorker?: (filename: string) => OcrWorker;
    },
  ) {
    if (!path.isAbsolute(options.resourceDirectory))
      throw new Error('OCR resourceDirectory must be an absolute local path');
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxTasksPerWorker = options.maxTasksPerWorker ?? 20;
    if (
      !Number.isFinite(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      !Number.isSafeInteger(this.maxTasksPerWorker) ||
      this.maxTasksPerWorker <= 0
    )
      throw new Error('Invalid OCR worker limits');
    this.createWorker =
      options.createWorker ??
      ((filename) =>
        new Worker(filename, {
          stdout: true,
          stderr: true,
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        }));
  }

  async recognize(bytes: Uint8Array): Promise<OcrResult> {
    if (this.stopped) return failure('stopped');
    if (this.active) return failure('busy');
    if (!validPng(bytes)) return failure('invalid_image');
    this.active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new OcrFailure('timeout')),
          this.timeoutMs,
        );
      });
      const text = await Promise.race([this.perform(bytes), deadline]);
      if (this.stopped) throw new OcrFailure('stopped');
      this.completed += 1;
      if (this.completed >= this.maxTasksPerWorker) await this.recycle();
      return {
        ocrStatus: 'succeeded',
        ocrError: null,
        ...normalizeOcrText(text),
      };
    } catch (error) {
      await this.recycle();
      return failure(
        error instanceof OcrFailure ? error.code : 'worker_failed',
      );
    } finally {
      clearTimeout(timer);
      this.active = false;
    }
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.stopping ??= this.recycle('stopped');
    return this.stopping;
  }

  private async perform(bytes: Uint8Array): Promise<string> {
    if (!this.worker) {
      const worker = this.createWorker(
        path.join(this.options.resourceDirectory, 'worker.mjs'),
      );
      this.worker = worker;
      worker.on('message', (packet) => {
        if (worker !== this.worker || packet.jobId !== this.pending?.id) return;
        if (packet.status === 'resolve') {
          this.pending.resolve(packet.data ?? {});
          this.pending = null;
        } else if (packet.status === 'reject') {
          this.pending.reject(new OcrFailure('recognition_failed'));
          this.pending = null;
        }
      });
      const crashed = () => {
        if (worker !== this.worker) return;
        this.initialized = false;
        this.pending?.reject(new OcrFailure('worker_failed'));
        this.pending = null;
        void this.recycle();
      };
      worker.on('error', crashed);
      worker.on('exit', crashed);
    }
    if (!this.initialized) {
      await this.send('load', { options: { lstmOnly: true, logging: false } });
      await this.send('loadLanguage', {
        langs: 'eng',
        options: {
          langPath: path.join(this.options.resourceDirectory, 'lang'),
          cacheMethod: 'none',
          gzip: true,
          lstmOnly: true,
        },
      });
      await this.send('initialize', { langs: 'eng', oem: 1, config: {} });
      this.initialized = true;
    }
    const data = await this.send('recognize', {
      image: bytes,
      options: {},
      output: { text: true },
    });
    if (typeof data.text !== 'string')
      throw new OcrFailure('recognition_failed');
    return data.text;
  }

  private send(action: string, payload: unknown): Promise<{ text?: string }> {
    if (this.stopped) return Promise.reject(new OcrFailure('stopped'));
    const worker = this.worker;
    if (!worker) return Promise.reject(new OcrFailure('worker_failed'));
    return new Promise((resolve, reject) => {
      const id = String(++this.jobId);
      this.pending = { id, resolve, reject };
      worker.postMessage({
        workerId: 'offline-ocr',
        jobId: id,
        action,
        payload,
      });
    });
  }

  private async recycle(reason: OcrError = 'worker_failed'): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.initialized = false;
    this.completed = 0;
    this.pending?.reject(new OcrFailure(reason));
    this.pending = null;
    if (worker) {
      const termination = worker.terminate().then(
        () => {},
        () => {},
      );
      this.retiring = Promise.all([this.retiring, termination]).then(() => {});
    }
    await this.retiring;
  }
}

export class LocalOcrRecognizer {
  constructor(private readonly service: OfflineOcr) {}
  async recognize(
    bytes: Buffer,
  ): Promise<{ text: string; truncated: boolean }> {
    const result = await this.service.recognize(bytes);
    if (result.ocrStatus === 'failed') throw new OcrFailure(result.ocrError);
    return { text: result.ocrText, truncated: result.truncated };
  }
  terminate(): Promise<void> {
    return this.service.stop();
  }
}
