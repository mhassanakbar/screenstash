import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@screenstash/db';
import { uploadInputSchema, deviceInputSchema } from '@screenstash/shared';
import sharp from 'sharp';
import { migrationSql } from '../helpers/database';
import { resolveOwner, registerDevice } from '../../apps/api/src/modules/users';
import { UploadService } from '../../apps/api/src/modules/uploads';
import { listScreenshots } from '../../apps/api/src/modules/screenshots';
import { parseEnvironment } from '../../apps/api/src/config/environment';
import { CaptureRepository } from '../../apps/desktop/src/main/capture/repository';
import { SyncCoordinator } from '../../apps/desktop/src/main/sync/coordinator';
import {
  OfflineOcr,
  LocalOcrRecognizer,
} from '../../apps/desktop/src/main/ocr';
import { LocalOcrQueue } from '../../apps/desktop/src/main/ocr/queue';

let embedded: PGlite;
beforeAll(async () => {
  await promisify(execFile)(process.execPath, [
    'scripts/prepare-desktop-ocr.mjs',
  ]);
  embedded = new PGlite();
  await embedded.exec(await migrationSql());
});
afterAll(async () => {
  if (embedded) await embedded.close();
});

it('recognizes a local capture and syncs its real OCR into PostgreSQL search through a fake API and private object store', async () => {
  const database = drizzle(embedded, { schema }) as unknown as schema.Database;
  const owner = await resolveOwner(database, 'user_' + randomUUID());
  const other = await resolveOwner(database, 'user_' + randomUUID());
  const device = await registerDevice(database, owner.id, {
    installationId: randomUUID(),
    name: 'Sync fixture',
  });
  const objects = new Map<string, Buffer>();
  const store = {
    authorize: async (key: string) => 'https://r2.invalid/' + key,
    read: async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error('Missing fixture object');
      return {
        body: Readable.from([bytes]),
        size: bytes.length,
        type: 'image/png',
      };
    },
    head: async (key: string) => ({
      size: objects.get(key)?.length ?? 0,
      type: 'image/png',
    }),
    write: async (key: string, bytes: Buffer) => {
      objects.set(key, bytes);
    },
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
  const service = new UploadService(database, store, parseEnvironment({}));
  const transport: typeof fetch = async (input, init) => {
    init?.signal?.throwIfAborted();
    const url = new URL(String(input));
    if (url.hostname === 'r2.invalid') {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      objects.set(url.pathname.slice(1), Buffer.from(init?.body as Uint8Array));
      return new Response(null);
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer fixture',
    );
    const body: unknown = init?.body
      ? JSON.parse(String(init.body))
      : undefined;
    let result: unknown;
    if (url.pathname === '/api/me') result = owner;
    else if (url.pathname === '/api/devices')
      result = await registerDevice(
        database,
        owner.id,
        deviceInputSchema.parse(body),
      );
    else if (url.pathname === '/api/upload-sessions')
      result = await service.authorize(owner.id, uploadInputSchema.parse(body));
    else {
      const parts = url.pathname.split('/');
      const sessionId = parts[3]!;
      if (parts[4] === 'finalize')
        result = await service.finalize(owner.id, sessionId);
      else if (parts[4] === 'renew')
        result = await service.renew(owner.id, sessionId);
      else result = service.dto(await service.get(owner.id, sessionId));
    }
    return new Response(JSON.stringify(result));
  };
  const base = path.resolve('test-results');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'sync-integration-'));
  if (
    path.dirname(directory) !== base ||
    !path.basename(directory).startsWith('sync-integration-')
  )
    throw new Error('Unexpected cleanup target');
  const repository = new CaptureRepository(directory);
  const coordinator = new SyncCoordinator({
    repository,
    baseUrl: 'https://api.invalid',
    getSessionToken: async () => 'fixture',
    fetch: transport,
  });
  const ocr = new LocalOcrQueue(
    repository,
    new LocalOcrRecognizer(
      new OfflineOcr({
        resourceDirectory: path.resolve('apps/desktop/resources/ocr'),
      }),
    ),
    () => {},
  );
  try {
    await repository.initialize();
    await repository.setIdentity({ owner, device });
    const bytes = await sharp(
      Buffer.from(
        '<svg width="1600" height="220"><rect width="100%" height="100%" fill="white"/><text x="40" y="130" font-family="Arial" font-size="64" fill="black">OFFLINE INVOICE 4729</text></svg>',
      ),
    )
      .png()
      .toBuffer();
    const capture = await repository.save(
      bytes,
      'display',
      new Date().toISOString(),
      repository.currentIdentity(),
    );
    await repository.update(capture.id, { ocrStatus: 'processing' });
    await coordinator.start();
    expect((await listScreenshots(database, owner.id, 10)).items).toHaveLength(
      0,
    );
    ocr.wake();
    await vi.waitFor(
      () => expect(repository.get(capture.id)?.ocrStatus).toBe('complete'),
      { timeout: 15000 },
    );
    expect(repository.get(capture.id)?.ocrText).toContain('INVOICE 4729');
    await coordinator.wake();
    const record = repository.get(capture.id)!;
    expect(record.uploadStatus).toBe('synced');
    const session = await service.get(owner.id, record.uploadSessionId!);
    expect(objects.get(session.finalKey!)).toEqual(bytes);
    expect(
      createHash('sha256')
        .update(objects.get(session.finalKey!)!)
        .digest('hex'),
    ).toBe(record.sha256);
    expect(
      (
        await listScreenshots(database, owner.id, 10, undefined, {
          q: 'invoice',
        })
      ).items.map((item) => item.id),
    ).toEqual([record.screenshotId]);
    expect(
      (
        await listScreenshots(database, other.id, 10, undefined, {
          q: 'invoice',
        })
      ).items,
    ).toHaveLength(0);
    const restarted = new CaptureRepository(directory);
    await restarted.initialize();
    expect(restarted.get(capture.id)?.uploadStatus).toBe('synced');
  } finally {
    await ocr.stop();
    await coordinator.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
