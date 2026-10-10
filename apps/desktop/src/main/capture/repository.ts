import {
  mkdir,
  open,
  rename,
  readFile,
  readdir,
  stat,
  lstat,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { identitySchema } from '../../contracts/bridge';
import {
  localCaptureSchema,
  captureSummarySchema,
  type LocalCapture,
  type CaptureIdentity,
} from '../../contracts/capture';
import { pngDimensions } from './geometry';

export async function writeAtomic(file: string, data: string | Buffer) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const MAX_LOCAL_BYTES = 1024 * 1024 * 1024;
const MAX_PNG_BYTES = 180 * 1024 * 1024;
export class CaptureRepository {
  private records = new Map<string, LocalCapture>();
  private writer: Promise<unknown> = Promise.resolve();
  private identity: CaptureIdentity | null = null;
  warnings = 0;
  localBytes = 0;
  constructor(private root: string) {}
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writer.then(work);
    this.writer = result.catch(() => {});
    return result;
  }
  currentIdentity() {
    return this.identity ? structuredClone(this.identity) : null;
  }
  async initialize() {
    await mkdir(path.join(this.root, 'captures'), { recursive: true });
    await mkdir(path.join(this.root, 'queue'), { recursive: true });
    try {
      this.identity = identitySchema
        .nullable()
        .parse(
          JSON.parse(
            await readFile(path.join(this.root, 'capture-owner.json'), 'utf8'),
          ),
        );
    } catch {
      this.identity = null;
    }
    const named = new Set<string>();
    const entries = await readdir(path.join(this.root, 'queue'));
    this.warnings += entries.filter((name) => name.endsWith('.tmp')).length;
    for (const file of entries.filter(
      (name) => name.endsWith('.json') || name.endsWith('.json.bak'),
    )) {
      const id = file.replace(/\.json(?:\.bak)?$/, '');
      if (!z.uuid().safeParse(id).success || named.has(id)) continue;
      named.add(id);
      const primary = path.join(this.root, 'queue', `${id}.json`);
      try {
        const original = JSON.parse(await readFile(primary, 'utf8')) as {
          schemaVersion?: unknown;
        };
        if (
          typeof original.schemaVersion === 'number' &&
          original.schemaVersion !== 1
        ) {
          this.warnings++;
          continue;
        }
      } catch {
        /* A damaged primary may be recovered from a valid backup. */
      }
      let record: LocalCapture | undefined;
      for (const candidate of [primary, `${primary}.bak`]) {
        try {
          const parsed = localCaptureSchema.parse(
            JSON.parse(await readFile(candidate, 'utf8')),
          );
          if (parsed.id !== id) throw new Error('Record identity mismatch');
          record = parsed;
          if (candidate !== primary) {
            await writeAtomic(primary, JSON.stringify(record));
            this.warnings++;
          }
          break;
        } catch {
          /* Preserve corrupt/unsupported records and their original PNG. */
        }
      }
      if (!record) {
        this.warnings++;
        continue;
      }
      try {
        const bytes = await this.readImage(record);
        if (
          digest(bytes) !== record.sha256 ||
          bytes.length !== record.sizeBytes
        )
          throw new Error();
        this.records.set(id, record);
      } catch {
        this.warnings++;
      }
    }
    for (const file of await readdir(path.join(this.root, 'captures'))) {
      if (!file.endsWith('.png')) {
        if (file.endsWith('.tmp')) this.warnings++;
        continue;
      }
      const id = file.slice(0, -4);
      const imageFile = path.join(this.root, 'captures', file);
      const imageStat = await lstat(imageFile);
      if (!imageStat.isFile()) {
        this.warnings++;
        continue;
      }
      this.localBytes += imageStat.size;
      if (!z.uuid().safeParse(id).success || named.has(id)) continue;
      try {
        const size = await stat(imageFile);
        if (size.size > MAX_PNG_BYTES) throw new Error();
        const bytes = await readFile(imageFile);
        const dimensions = pngDimensions(bytes);
        const record = this.record(
          id,
          bytes,
          dimensions,
          'recovered',
          new Date(size.mtimeMs).toISOString(),
          null,
        );
        await writeAtomic(
          path.join(this.root, 'queue', `${id}.json`),
          JSON.stringify(record),
        );
        this.records.set(id, record);
        this.warnings++;
      } catch {
        this.warnings++;
      }
    }
  }
  setIdentity(identity: CaptureIdentity | null) {
    // Clear memory immediately on sign-out; serialized persistence cannot bind a
    // newly started capture to the account that just signed out.
    this.identity = identity ? structuredClone(identity) : null;
    return this.serialize(() =>
      writeAtomic(
        path.join(this.root, 'capture-owner.json'),
        JSON.stringify(identity),
      ),
    );
  }
  private record(
    id: string,
    bytes: Buffer,
    dimensions: { width: number; height: number },
    mode: 'display' | 'region' | 'recovered',
    capturedAt: string,
    identity: CaptureIdentity | null,
  ) {
    return localCaptureSchema.parse({
      schemaVersion: 1,
      id,
      capturedAt,
      mode,
      title: `Screenshot ${capturedAt.slice(0, 19).replace('T', ' ')}`,
      png: `${id}.png`,
      ...dimensions,
      sizeBytes: bytes.length,
      sha256: digest(bytes),
      identity,
      ocrStatus: 'pending',
      uploadStatus: 'pending',
      uploadEligible: bytes.length <= 20971520,
    });
  }
  save(
    bytes: Buffer,
    mode: 'display' | 'region',
    capturedAt: string,
    identity: CaptureIdentity | null,
  ) {
    return this.serialize(async () => {
      if (
        bytes.length > MAX_PNG_BYTES ||
        this.localBytes + bytes.length > MAX_LOCAL_BYTES
      )
        throw new Error('Local storage limit');
      const record = this.record(
        randomUUID(),
        bytes,
        pngDimensions(bytes),
        mode,
        capturedAt,
        identity,
      );
      await writeAtomic(path.join(this.root, 'captures', record.png), bytes);
      this.localBytes += bytes.length;
      const manifest = path.join(this.root, 'queue', `${record.id}.json`);
      await writeAtomic(`${manifest}.bak`, JSON.stringify(record));
      await writeAtomic(manifest, JSON.stringify(record));
      this.records.set(record.id, record);
      return this.summary(record);
    });
  }
  summary(record: LocalCapture) {
    return captureSummarySchema.parse({
      ...record,
      assigned: Boolean(record.identity),
    });
  }
  private visible(record: LocalCapture) {
    return (
      !record.identity ||
      (record.identity.owner.id === this.identity?.owner.id &&
        record.identity.owner.clerkUserId === this.identity?.owner.clerkUserId)
    );
  }
  list() {
    return [...this.records.values()]
      .filter((record) => this.visible(record))
      .sort(
        (a, b) =>
          b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id),
      )
      .slice(0, 100)
      .map((record) => this.summary(record));
  }
  async imagePath(id: string) {
    const record = this.records.get(z.uuid().parse(id));
    if (!record || !this.visible(record))
      throw new Error('Capture not available');
    const bytes = await this.readImage(record);
    if (digest(bytes) !== record.sha256) throw new Error('Capture damaged');
    return path.join(this.root, 'captures', record.png);
  }
  private async readImage(record: LocalCapture) {
    const file = path.join(this.root, 'captures', record.png);
    const size = await lstat(file);
    if (!size.isFile() || size.size > MAX_PNG_BYTES)
      throw new Error('Invalid capture file');
    const bytes = await readFile(file);
    const actual = pngDimensions(bytes);
    if (actual.width !== record.width || actual.height !== record.height)
      throw new Error('Image dimensions changed');
    return bytes;
  }
}
