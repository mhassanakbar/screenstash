import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@screenstash/db';
import type { Database } from '@screenstash/db';
import sharp from 'sharp';
import request from 'supertest';
import { temporaryPostgres, migrationSql } from '../helpers/database.js';
import { resolveOwner } from '../../apps/api/src/modules/users.js';
import { UploadService } from '../../apps/api/src/modules/uploads.js';
import { ShareService } from '../../apps/api/src/modules/shares.js';
import { deleteScreenshot } from '../../apps/api/src/modules/screenshots.js';
import { deleteAccount } from '../../apps/api/src/webhooks/clerk.js';
import { runMaintenance } from '../../apps/api/src/modules/cleanup.js';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnvironment } from '../../apps/api/src/config/environment.js';
import { HttpError } from '../../apps/api/src/middleware/errors.js';
import type { ObjectStore } from '../../apps/api/src/storage/r2.js';

class MemoryStore implements ObjectStore {
  objects = new Map<string, { bytes: Buffer; type: string }>();
  afterPreviewWrite?: () => Promise<void>;
  async authorize() {
    return 'https://storage.example/upload';
  }
  async head(key: string) {
    const object = this.objects.get(key);
    if (!object)
      throw new HttpError(
        404,
        'NOT_FOUND',
        'This shared screenshot is unavailable.',
      );
    return { size: object.bytes.length, type: object.type };
  }
  async read(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new HttpError(404, 'UPLOAD_NOT_READY', 'Missing object');
    return {
      body: Readable.from([object.bytes]),
      size: object.bytes.length,
      type: object.type,
    };
  }
  async write(key: string, bytes: Buffer, type: string) {
    this.objects.set(key, { bytes, type });
    if (type === 'image/jpeg') await this.afterPreviewWrite?.();
  }
  async remove(key: string) {
    this.objects.delete(key);
  }
}
describe('Public sharing and revocation', () => {
  let temporary: Awaited<ReturnType<typeof temporaryPostgres>>,
    database: Database;
  const environment = parseEnvironment({
    PUBLIC_BASE_URL: 'http://localhost:3000',
  });
  beforeAll(async () => {
    temporary = await temporaryPostgres();
    await temporary.pool.query(await migrationSql(temporary.schemaName));
    database = drizzle(temporary.pool, { schema });
  });
  afterAll(async () => {
    if (temporary) await temporary.close();
  });
  async function fixture() {
    const owner = await resolveOwner(database, `user_${randomUUID()}`),
      store = new MemoryStore();
    const bytes = await sharp({
      create: { width: 25, height: 12, channels: 4, background: '#11a38180' },
    })
      .png()
      .toBuffer();
    const upload = new UploadService(database, store, environment);
    const session = await upload.authorize(owner.id, {
      captureId: randomUUID(),
      title: 'Private title secret',
      capturedAt: new Date().toISOString(),
      mimeType: 'image/png',
      sizeBytes: bytes.length,
      width: 25,
      height: 12,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ocrStatus: 'complete',
      ocrText: 'Private OCR secret',
      ocrTruncated: false,
    });
    const stored = await upload.get(owner.id, session.id);
    await store.write(stored.stagingKey, bytes, 'image/png');
    const image = await upload.finalize(owner.id, session.id);
    const shares = new ShareService(database, store, environment);
    return {
      owner,
      store,
      bytes,
      image,
      shares,
      app: createApp(environment, { database, store }),
    };
  }
  function token(url: string) {
    return new URL(url).pathname.split('/').at(-1)!;
  }
  it('stores only a token hash and exposes approved metadata with a stripped JPEG preview', async () => {
    const { owner, store, image, bytes, shares, app } = await fixture();
    const created = await shares.create(
        owner.id,
        image.id,
        'Approved public title',
        false,
      ),
      value = token(created.url);
    const [row] = await database
      .select()
      .from(schema.screenshotShares)
      .where(eq(schema.screenshotShares.screenshotId, image.id));
    expect(row!.tokenHash).toBe(
      createHash('sha256').update(value).digest('hex'),
    );
    expect(JSON.stringify(row)).not.toContain(value);
    const status = await shares.status(owner.id, image.id);
    expect(status).toMatchObject({
      active: true,
      publicTitle: 'Approved public title',
    });
    expect(JSON.stringify(status)).not.toContain(value);
    const details = await request(app).get(`/api/public/shares/${value}`);
    expect(details.status).toBe(200);
    expect(Object.keys(details.body).sort()).toEqual([
      'height',
      'imageUrl',
      'mimeType',
      'previewUrl',
      'publicTitle',
      'width',
    ]);
    expect(JSON.stringify(details.body)).not.toMatch(
      /Private title secret|Private OCR secret|userId|objectKey|captureId/,
    );
    const metadata = await sharp(
      store.objects.get(row!.previewObjectKey)!.bytes,
    ).metadata();
    expect(metadata).toMatchObject({
      format: 'jpeg',
      width: 1200,
      height: 630,
      hasAlpha: false,
    });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    const original = await request(app).get(`/s/${value}/image`);
    expect(original.status).toBe(200);
    expect(original.body).toEqual(bytes);
    expect(original.headers['cache-control']).toContain('no-store');
    expect(original.headers['content-disposition']).toBe(
      'inline; filename="screenshot.png"',
    );
    const head = await request(app).head(`/s/${value}/preview.jpg`);
    expect(head.status).toBe(200);
    expect(head.headers['content-type']).toBe('image/jpeg');
    expect(Number(head.headers['content-length'])).toBe(
      store.objects.get(row!.previewObjectKey)!.bytes.length,
    );
    const other = await resolveOwner(database, `user_${randomUUID()}`);
    await expect(shares.status(other.id, image.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      shares.create(other.id, image.id, 'Unauthorized', true),
    ).rejects.toMatchObject({ status: 404 });
    await expect(shares.revoke(other.id, image.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('requires explicit replacement and rechecks warmed GET, HEAD and conditional requests after revocation', async () => {
    const { owner, image, shares, app } = await fixture();
    const first = token(
      (await shares.create(owner.id, image.id, 'First public title', false))
        .url,
    );
    await expect(
      shares.create(owner.id, image.id, 'Accidental replacement', false),
    ).rejects.toMatchObject({ status: 409 });
    const second = token(
      (
        await shares.create(
          owner.id,
          image.id,
          'Replacement public title',
          true,
        )
      ).url,
    );
    expect(first === second).toBe(false);
    expect((await request(app).get(`/s/${first}/image`)).status).toBe(404);
    expect((await request(app).get(`/s/${second}/preview.jpg`)).status).toBe(
      200,
    );
    await shares.revoke(owner.id, image.id);
    await shares.revoke(owner.id, image.id);
    expect((await shares.status(owner.id, image.id)).active).toBe(false);
    for (const path of [
      `/api/public/shares/${second}`,
      `/s/${second}/image`,
      `/s/${second}/preview.jpg`,
    ]) {
      expect(
        (await request(app).get(path).set('If-None-Match', '*')).status,
      ).toBe(404);
      expect((await request(app).head(path)).status).toBe(404);
    }
    expect((await request(app).get('/s/invalid/image')).status).toBe(404);
    expect((await request(app).get(`/s/${'a'.repeat(43)}/image`)).status).toBe(
      404,
    );
  });
  it('immediately excludes deleted screenshots and deleted accounts from public access', async () => {
    for (const deletion of ['screenshot', 'account']) {
      const { owner, image, shares, app } = await fixture();
      const value = token(
        (await shares.create(owner.id, image.id, 'Disposable share', false))
          .url,
      );
      if (deletion === 'screenshot')
        await deleteScreenshot(database, owner.id, image.id);
      else
        await deleteAccount(
          database,
          `event_${randomUUID()}`,
          owner.clerkUserId,
        );
      expect(
        (await request(app).get(`/api/public/shares/${value}`)).status,
      ).toBe(404);
      expect((await request(app).head(`/s/${value}/image`)).status).toBe(404);
      expect((await request(app).get(`/s/${value}/preview.jpg`)).status).toBe(
        404,
      );
    }
  });
  it('never activates a link if deletion wins during preview generation and cleans its orphan', async () => {
    const { owner, store, image, shares } = await fixture();
    store.afterPreviewWrite = () =>
      deleteScreenshot(database, owner.id, image.id);
    await expect(
      shares.create(owner.id, image.id, 'Interrupted share', false),
    ).rejects.toMatchObject({ status: 404 });
    const records = await database
      .select()
      .from(schema.screenshotShares)
      .where(eq(schema.screenshotShares.screenshotId, image.id));
    expect(records).toHaveLength(0);
    const preview = [...store.objects.keys()].find((key) =>
      key.startsWith('previews/'),
    )!;
    expect(preview).toBeTruthy();
    await temporary.pool.query(
      "UPDATE cleanup_jobs SET not_before=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE object_key=$1",
      [preview],
    );
    await runMaintenance(database, store);
    expect(store.objects.has(preview)).toBe(false);
  });
  it('returns a generic unavailable response when a required object disappears', async () => {
    const { owner, store, image, shares, app } = await fixture();
    const value = token(
      (await shares.create(owner.id, image.id, 'Missing preview', false)).url,
    );
    const preview = [...store.objects.keys()].find((key) =>
      key.startsWith('previews/'),
    )!;
    store.objects.delete(preview);
    expect((await request(app).get(`/api/public/shares/${value}`)).status).toBe(
      404,
    );
    expect((await request(app).head(`/s/${value}/preview.jpg`)).status).toBe(
      404,
    );
  });
});
