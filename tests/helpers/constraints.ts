import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrationSql, type SqlDatabase } from './database.js';

export function constraintSuite(
  name: string,
  factory: () => Promise<{ sql: SqlDatabase; close: () => Promise<void> }>,
) {
  describe(name, () => {
    let database: Awaited<ReturnType<typeof factory>>;
    let a: string, b: string;
    const statement = (text: string, values?: unknown[]) =>
      database.sql.query(text, values);
    beforeAll(async () => {
      database = await factory();
      await database.sql.exec(await migrationSql());
    });
    afterAll(async () => {
      if (database) await database.close();
    });
    beforeEach(async () => {
      await database.sql.exec(
        'TRUNCATE cleanup_jobs, devices, rate_limits, screenshot_shares, screenshot_tags, screenshots, tags, upload_sessions, users, webhook_events CASCADE',
      );
      a = randomUUID();
      b = randomUUID();
      await statement(
        'INSERT INTO users (id, clerk_user_id) VALUES ($1,$2),($3,$4)',
        [a, 'user_a', b, 'user_b'],
      );
    });
    async function screenshot(
      user = a,
      capture = randomUUID(),
      patch: {
        width?: number;
        mime?: string;
        ocrStatus?: string;
        ocrText?: string;
      } = {},
    ) {
      const id = randomUUID();
      await statement(
        `INSERT INTO screenshots (id,user_id,capture_id,title,object_key,mime_type,size_bytes,width,height,sha256,ocr_status,ocr_text,captured_at,search_vector)
        VALUES ($1,$2,$3,'Fixture',$4,$5,10,$6,10,$7,$8,$9,now(),to_tsvector('simple','Fixture text'))`,
        [
          id,
          user,
          capture,
          `originals/${user}/${id}.png`,
          patch.mime ?? 'image/png',
          patch.width ?? 10,
          'a'.repeat(64),
          patch.ocrStatus ?? 'complete',
          patch.ocrText ?? 'text',
        ],
      );
      return id;
    }
    it('enforces unique identities and normalized tags per owner', async () => {
      await expect(
        statement('INSERT INTO users (clerk_user_id) VALUES ($1)', ['user_a']),
      ).rejects.toMatchObject({ code: '23505' });
      await statement(
        "INSERT INTO tags (user_id,name,normalized_name) VALUES ($1,'Work','work')",
        [a],
      );
      await expect(
        statement(
          "INSERT INTO tags (user_id,name,normalized_name) VALUES ($1,'WORK','work')",
          [a],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await statement(
        "INSERT INTO tags (user_id,name,normalized_name) VALUES ($1,'Work','work')",
        [b],
      );
    });
    it('prevents capture duplicates and permits minimal deletion tombstones', async () => {
      const capture = randomUUID();
      await screenshot(a, capture);
      await expect(screenshot(a, capture)).rejects.toMatchObject({
        code: '23505',
      });
      await screenshot(b, capture);
      await statement(
        'INSERT INTO screenshots (id,user_id,capture_id,deleted_at) VALUES ($1,$2,$3,now())',
        [randomUUID(), a, randomUUID()],
      );
      await expect(
        statement(
          'INSERT INTO screenshots (id,user_id,capture_id) VALUES ($1,$2,$3)',
          [randomUUID(), a, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('rejects foreign-owner screenshot/tag associations', async () => {
      const image = await screenshot();
      const foreignTag = randomUUID();
      await statement(
        "INSERT INTO tags (id,user_id,name,normalized_name) VALUES ($1,$2,'Other','other')",
        [foreignTag, b],
      );
      await expect(
        statement(
          'INSERT INTO screenshot_tags (user_id,screenshot_id,tag_id) VALUES ($1,$2,$3)',
          [a, image, foreignTag],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
    it('rejects foreign devices even when their UUID is known', async () => {
      const device = randomUUID();
      await statement(
        "INSERT INTO devices (id,user_id,installation_id,name) VALUES ($1,$2,$3,'PC')",
        [device, b, randomUUID()],
      );
      const image = await screenshot();
      await expect(
        statement('UPDATE screenshots SET device_id=$1 WHERE id=$2', [
          device,
          image,
        ]),
      ).rejects.toMatchObject({ code: '23503' });
    });
    it('enforces image limits and OCR failure consistency', async () => {
      await expect(
        screenshot(a, randomUUID(), { width: 16385 }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        screenshot(a, randomUUID(), { mime: 'image/svg+xml' }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        screenshot(a, randomUUID(), { ocrStatus: 'failed', ocrText: 'unsafe' }),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('allows one active share and enforces its owner', async () => {
      const image = await screenshot();
      const insert = (user = a) =>
        statement(
          'INSERT INTO screenshot_shares (user_id,screenshot_id,token_hash,public_title,preview_object_key) VALUES ($1,$2,$3,$4,$5)',
          [
            user,
            image,
            randomUUID().replaceAll('-', '').repeat(2),
            'Public',
            randomUUID(),
          ],
        );
      await expect(insert(b)).rejects.toMatchObject({ code: '23503' });
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: '23505' });
      await statement(
        'UPDATE screenshot_shares SET revoked_at=now() WHERE screenshot_id=$1',
        [image],
      );
      await insert();
    });
    it('enforces cleanup lease pairing and pending-object deduplication', async () => {
      const key = 'staging/fixture.png';
      const insert = () =>
        statement(
          "INSERT INTO cleanup_jobs (object_key,reason,not_before,next_attempt_at) VALUES ($1,'fixture',now(),now())",
          [key],
        );
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: '23505' });
      await expect(
        statement('UPDATE cleanup_jobs SET lease_token=$1', [randomUUID()]),
      ).rejects.toMatchObject({ code: '23514' });
      await statement('UPDATE cleanup_jobs SET completed_at=now()');
      await insert();
    });
    it('creates a working full-text GIN index and queries OCR text', async () => {
      const image = await screenshot();
      const result = await statement(
        "SELECT id FROM screenshots WHERE search_vector @@ websearch_to_tsquery('simple',$1)",
        ['text'],
      );
      expect(result.rows[0]?.id).toBe(image);
      const indexes = await statement(
        "SELECT indexdef FROM pg_indexes WHERE indexname='screenshots_search'",
      );
      expect(indexes.rows[0]?.indexdef).toContain('USING gin');
    });
  });
}
