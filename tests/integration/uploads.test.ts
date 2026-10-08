import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@screenstash/db';
import type { Database } from '@screenstash/db';
import sharp from 'sharp';
import { temporaryPostgres, migrationSql } from '../helpers/database.js';
import { resolveOwner } from '../../apps/api/src/modules/users.js';
import { UploadService } from '../../apps/api/src/modules/uploads.js';
import {
  getScreenshot,
  listScreenshots,
  deleteScreenshot,
  updateScreenshot,
  createTag,
} from '../../apps/api/src/modules/screenshots.js';
import { runMaintenance } from '../../apps/api/src/modules/cleanup.js';
import { parseEnvironment } from '../../apps/api/src/config/environment.js';
import { verifyPng } from '../../apps/api/src/storage/images.js';
import type { ObjectStore } from '../../apps/api/src/storage/r2.js';

class MemoryStore implements ObjectStore {
  objects = new Map<string, Buffer>();
  async authorize(key: string) {
    return `https://storage.example/${key}`;
  }
  async read(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error('Missing test object');
    return {
      body: Readable.from([bytes]),
      size: bytes.length,
      type: 'image/png',
    };
  }
  async head(key: string) {
    return { size: this.objects.get(key)?.length ?? 0, type: 'image/png' };
  }
  async write(key: string, bytes: Buffer) {
    this.objects.set(key, bytes);
  }
  async remove(key: string) {
    this.objects.delete(key);
  }
}
describe('Upload verification and durable cleanup', () => {
  let temporary: Awaited<ReturnType<typeof temporaryPostgres>>;
  let database: Database;
  beforeAll(async () => {
    temporary = await temporaryPostgres();
    await temporary.pool.query(await migrationSql(temporary.schemaName));
    database = drizzle(temporary.pool, { schema });
  });
  afterAll(async () => {
    if (temporary) await temporary.close();
  });
  async function fixture() {
    const owner = await resolveOwner(database, `user_${randomUUID()}`);
    const store = new MemoryStore();
    const bytes = await sharp({
      create: { width: 12, height: 9, channels: 4, background: '#12a37f' },
    })
      .png()
      .toBuffer();
    const input = {
      captureId: randomUUID(),
      title: 'Verified fixture',
      capturedAt: new Date().toISOString(),
      mimeType: 'image/png' as const,
      sizeBytes: bytes.length,
      width: 12,
      height: 9,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ocrStatus: 'complete' as const,
      ocrText: 'Find this fixture',
      ocrTruncated: false,
    };
    const service = new UploadService(database, store, parseEnvironment({}));
    const authorized = await service.authorize(owner.id, input);
    const session = await service.get(owner.id, authorized.id);
    await store.write(session.stagingKey, bytes);
    return { owner, store, bytes, input, service, session };
  }
  it('finalizes once, preserves verified bytes after staging overwrite, and isolates ownership', async () => {
    const { owner, store, bytes, input, service, session } = await fixture();
    const results = await Promise.allSettled([
      service.finalize(owner.id, session.id),
      service.finalize(owner.id, session.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled').length,
    ).toBeGreaterThan(0);
    const result = await service.finalize(owner.id, session.id);
    expect(result.id).toBe(session.screenshotId);
    const current = await service.get(owner.id, session.id);
    expect(store.objects.get(current.finalKey)).toEqual(bytes);
    await store.write(current.stagingKey, Buffer.from('overwritten staging'));
    expect(store.objects.get(current.finalKey)).toEqual(bytes);
    expect((await service.authorize(owner.id, input)).status).toBe('finalized');
    await expect(
      service.authorize(owner.id, { ...input, title: 'Changed' }),
    ).rejects.toMatchObject({ status: 409 });
    const other = await resolveOwner(database, `user_${randomUUID()}`);
    await expect(service.get(other.id, session.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (
        await temporary.pool.query(
          'SELECT id FROM screenshots WHERE user_id=$1',
          [owner.id],
        )
      ).rowCount,
    ).toBe(1);
    await runMaintenance(database, store);
    expect(store.objects.get(current.finalKey)).toEqual(bytes);
  });
  it('rejects corrupt bytes and retires renewed attempts after their last write expiry', async () => {
    const { owner, store, bytes, service, session } = await fixture();
    await store.write(session.stagingKey, Buffer.alloc(bytes.length));
    await expect(service.finalize(owner.id, session.id)).rejects.toMatchObject({
      code: 'UPLOAD_INVALID',
    });
    expect((await service.get(owner.id, session.id)).status).toBe('rejected');
    await service.renew(owner.id, session.id);
    const renewed = await service.get(owner.id, session.id);
    expect(renewed.stagingKey).not.toBe(session.stagingKey);
    const job = await temporary.pool.query(
      'SELECT not_before FROM cleanup_jobs WHERE object_key=$1 AND completed_at IS NULL',
      [session.stagingKey],
    );
    expect(new Date(job.rows[0].not_before).getTime()).toBeGreaterThan(
      session.latestPutExpiresAt.getTime(),
    );
    await store.write(renewed.stagingKey, bytes);
    expect((await service.finalize(owner.id, session.id)).id).toBe(
      session.screenshotId,
    );
  });
  it('checks decoded PNG pixels and dimensions, not just the signature and checksum', async () => {
    const { bytes, input } = await fixture();
    await expect(
      verifyPng(bytes, { ...input, width: 13 }),
    ).rejects.toMatchObject({ code: 'UPLOAD_INVALID' });
    const truncated = bytes.subarray(0, 50);
    await expect(
      verifyPng(truncated, {
        ...input,
        sizeBytes: truncated.length,
        sha256: createHash('sha256').update(truncated).digest('hex'),
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_INVALID' });
  });
  it('enforces transactional outstanding-upload quotas', async () => {
    const { owner, store, service, input } = await fixture();
    const limited = new UploadService(
      database,
      store,
      parseEnvironment({ ACCOUNT_PENDING_UPLOADS: 1 }),
    );
    await expect(
      limited.authorize(owner.id, { ...input, captureId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect((await service.authorize(owner.id, input)).id).toBeTruthy();
  });
  it('paginates tied dates consistently and denies foreign reads and deletion', async () => {
    const { owner, store, bytes, input, service, session } = await fixture();
    await service.finalize(owner.id, session.id);
    for (let i = 0; i < 3; i++) {
      const upload = await service.authorize(owner.id, {
        ...input,
        captureId: randomUUID(),
      });
      const current = await service.get(owner.id, upload.id);
      await store.write(current.stagingKey, bytes);
      await service.finalize(owner.id, current.id);
    }
    const first = await listScreenshots(database, owner.id, 2);
    const second = await listScreenshots(
      database,
      owner.id,
      2,
      first.nextCursor!,
    );
    expect(
      new Set([...first.items, ...second.items].map((image) => image.id)).size,
    ).toBe(4);
    expect(second.nextCursor).toBeNull();
    const foreign = await resolveOwner(database, `user_${randomUUID()}`);
    expect((await listScreenshots(database, foreign.id, 10)).items).toEqual([]);
    await expect(
      getScreenshot(database, foreign.id, session.screenshotId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteScreenshot(database, foreign.id, session.screenshotId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      listScreenshots(database, foreign.id, 2, first.nextCursor!),
    ).rejects.toMatchObject({ status: 400 });
    await deleteScreenshot(database, owner.id, session.screenshotId);
    await expect(
      getScreenshot(database, owner.id, session.screenshotId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.authorize(owner.id, input)).rejects.toMatchObject({
      code: 'CAPTURE_DELETED',
    });
    await expect(service.finalize(owner.id, session.id)).rejects.toMatchObject({
      code: 'CAPTURE_DELETED',
    });
  });
  it('recovers expired cleanup leases and backs off failed deletes', async () => {
    const { owner, store } = await fixture();
    const key = `orphan/${randomUUID()}.png`;
    await store.write(key, Buffer.from('test orphan'));
    await temporary.pool.query(
      "INSERT INTO cleanup_jobs (user_id,object_key,reason,not_before,next_attempt_at,lease_token,lease_expires_at) VALUES ($1,$2,'fixture',now(),now(),gen_random_uuid(),now()-interval '1 minute')",
      [owner.id, key],
    );
    const original = store.remove.bind(store);
    store.remove = async (objectKey) => {
      if (objectKey === key) throw new Error('Storage temporarily unavailable');
      await original(objectKey);
    };
    await runMaintenance(database, store, 50);
    const failed = (
      await temporary.pool.query(
        'SELECT completed_at,next_attempt_at,lease_token FROM cleanup_jobs WHERE object_key=$1',
        [key],
      )
    ).rows[0];
    expect(failed.completed_at).toBeNull();
    expect(failed.lease_token).toBeNull();
    expect(failed.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    store.remove = original;
    await temporary.pool.query(
      'UPDATE cleanup_jobs SET next_attempt_at=now() WHERE object_key=$1',
      [key],
    );
    await Promise.all([
      runMaintenance(database, store, 50),
      runMaintenance(database, store, 50),
    ]);
    expect(store.objects.has(key)).toBe(false);
    expect(
      (
        await temporary.pool.query(
          'SELECT completed_at FROM cleanup_jobs WHERE object_key=$1',
          [key],
        )
      ).rows[0].completed_at,
    ).toBeInstanceOf(Date);
  });
  it('indexes title, tags and OCR transactionally with owner, date and AND-tag filters', async () => {
    const { owner, service, session, store, bytes, input } = await fixture();
    await service.finalize(owner.id, session.id);
    const work = await createTag(database, owner.id, 'Work');
    expect((await createTag(database, owner.id, 'WORK')).id).toBe(work.id);
    const project = await createTag(database, owner.id, 'Project');
    await updateScreenshot(database, owner.id, session.screenshotId, {
      title: 'Semantics',
      tagIds: [work.id, project.id],
    });
    expect(
      (
        await listScreenshots(database, owner.id, 10, undefined, {
          q: 'Work',
          tagId: [work.id, project.id],
        })
      ).items.map((image) => image.id),
    ).toEqual([session.screenshotId]);
    expect(
      (await listScreenshots(database, owner.id, 10, undefined, { q: 'Find' }))
        .items,
    ).toHaveLength(1);
    const upload = await service.authorize(owner.id, {
      ...input,
      captureId: randomUUID(),
      title: 'Other capture',
      ocrText: 'semantics',
    });
    const other = await service.get(owner.id, upload.id);
    await store.write(other.stagingKey, bytes);
    await service.finalize(owner.id, other.id);
    const ranked = await listScreenshots(database, owner.id, 1, undefined, {
      q: 'semantics',
    });
    expect(ranked.items[0]?.id).toBe(session.screenshotId);
    expect(
      (
        await listScreenshots(database, owner.id, 1, ranked.nextCursor!, {
          q: 'semantics',
        })
      ).items[0]?.id,
    ).toBe(other.screenshotId);
    await expect(
      listScreenshots(database, owner.id, 1, ranked.nextCursor!, {
        q: 'changed',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await listScreenshots(database, owner.id, 10, undefined, { q: '!!!' }))
        .items,
    ).toEqual([]);
    expect(
      (
        await listScreenshots(database, owner.id, 10, undefined, {
          to: input.capturedAt,
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await listScreenshots(database, owner.id, 10, undefined, {
          from: input.capturedAt,
        })
      ).items,
    ).toHaveLength(2);
    const foreign = await resolveOwner(database, `user_${randomUUID()}`);
    const foreignTag = await createTag(database, foreign.id, 'Private tag');
    await expect(
      updateScreenshot(database, owner.id, session.screenshotId, {
        title: 'Rollback',
        tagIds: [foreignTag.id],
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await getScreenshot(database, owner.id, session.screenshotId)).title,
    ).toBe('Semantics');
    await updateScreenshot(database, owner.id, session.screenshotId, {
      tagIds: [],
    });
    expect(
      (await listScreenshots(database, owner.id, 10, undefined, { q: 'Work' }))
        .items,
    ).toEqual([]);
  });
});
