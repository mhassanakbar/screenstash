import { randomUUID, createHash } from 'node:crypto';
import { config } from 'dotenv';
import { expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@screenstash/db';
import sharp from 'sharp';
import { temporaryPostgres, migrationSql } from '../helpers/database.js';
import { parseEnvironment } from '../../apps/api/src/config/environment.js';
import {
  createObjectStore,
  boundedRead,
} from '../../apps/api/src/storage/r2.js';
import { resolveOwner } from '../../apps/api/src/modules/users.js';
import { UploadService } from '../../apps/api/src/modules/uploads.js';

it('uploads via real R2 presigned PUT and publishes exactly the verified immutable bytes', async () => {
  config({ path: 'apps/api/.env', quiet: true });
  const environment = parseEnvironment(process.env);
  const store = createObjectStore(environment);
  if (!store)
    throw new Error(
      'Configure R2 development storage before running this integration gate.',
    );
  const temporary = await temporaryPostgres();
  const keys = new Set<string>();
  try {
    await temporary.pool.query(await migrationSql(temporary.schemaName));
    const database = drizzle(temporary.pool, { schema });
    const owner = await resolveOwner(
      database,
      `user_r2_fixture_${randomUUID()}`,
    );
    const bytes = await sharp({
      create: { width: 32, height: 20, channels: 4, background: '#168d70' },
    })
      .png()
      .toBuffer();
    const input = {
      captureId: randomUUID(),
      title: 'Storage verification fixture',
      capturedAt: new Date().toISOString(),
      mimeType: 'image/png' as const,
      sizeBytes: bytes.length,
      width: 32,
      height: 20,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ocrStatus: 'complete' as const,
      ocrText: 'Synthetic storage verification',
      ocrTruncated: false,
    };
    const service = new UploadService(database, store, environment);
    const authorized = await service.authorize(owner.id, input);
    expect(authorized.putUrl).toBeTruthy();
    const session = await service.get(owner.id, authorized.id);
    keys.add(session.stagingKey);
    keys.add(session.finalKey);
    const uploaded = await fetch(authorized.putUrl!, {
      method: 'PUT',
      headers: authorized.requiredHeaders ?? {},
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30000),
    });
    expect(uploaded.ok).toBe(true);
    const result = await service.finalize(owner.id, session.id);
    expect(result.id).toBe(session.screenshotId);
    expect((await service.finalize(owner.id, session.id)).id).toBe(result.id);
    const finalized = await service.get(owner.id, session.id);
    keys.add(finalized.finalKey);
    const original = await boundedRead(store, finalized.finalKey, bytes.length);
    expect(createHash('sha256').update(original.bytes).digest('hex')).toBe(
      input.sha256,
    );
    // The same still-valid staging URL cannot mutate the published object.
    const changed = Buffer.alloc(bytes.length, 42);
    expect(
      (
        await fetch(authorized.putUrl!, {
          method: 'PUT',
          headers: authorized.requiredHeaders ?? {},
          body: new Uint8Array(changed),
          signal: AbortSignal.timeout(30000),
        })
      ).ok,
    ).toBe(true);
    expect(
      (await boundedRead(store, finalized.finalKey, bytes.length)).bytes,
    ).toEqual(bytes);
  } finally {
    // Discover any keys reserved before an interrupted finalization, then remove only this test's objects.
    const rows = await temporary.pool.query(
      'SELECT staging_key, final_key FROM upload_sessions UNION ALL SELECT object_key, object_key FROM cleanup_jobs',
    );
    for (const row of rows.rows) {
      keys.add(row.staging_key);
      keys.add(row.final_key);
    }
    const removed = await Promise.allSettled(
      [...keys].map((key) => store.remove(key)),
    );
    await temporary.close();
    if (removed.some((result) => result.status === 'rejected'))
      throw new Error(
        'Some disposable R2 fixture objects could not be removed.',
      );
  }
});
