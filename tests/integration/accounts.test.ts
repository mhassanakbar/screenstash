import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@screenstash/db';
import type { Database } from '@screenstash/db';
import request from 'supertest';
import { Webhook } from 'svix';
import {
  resolveOwner,
  registerDevice,
} from '../../apps/api/src/modules/users.js';
import { deleteAccount } from '../../apps/api/src/webhooks/clerk.js';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnvironment } from '../../apps/api/src/config/environment.js';
import { temporaryPostgres, migrationSql } from '../helpers/database.js';

describe('Account ownership and deletion', () => {
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
  it('provisions one owner concurrently and scopes device identity to each owner', async () => {
    const identity = `user_${randomUUID()}`;
    const owners = await Promise.all(
      Array.from({ length: 5 }, () => resolveOwner(database, identity)),
    );
    expect(new Set(owners.map((owner) => owner.id)).size).toBe(1);
    const owner = owners[0]!;
    const other = await resolveOwner(database, `user_${randomUUID()}`);
    const installationId = randomUUID();
    const first = await registerDevice(database, owner.id, {
      installationId,
      name: 'Laptop',
    });
    const updated = await registerDevice(database, owner.id, {
      installationId,
      name: 'Renamed',
    });
    const separate = await registerDevice(database, other.id, {
      installationId,
      name: 'Other laptop',
    });
    expect(updated.id).toBe(first.id);
    expect(updated.name).toBe('Renamed');
    expect(separate.id).not.toBe(first.id);
  });
  it('records early deletion and prevents concurrent requests from resurrecting an identity', async () => {
    const identity = `user_${randomUUID()}`;
    const eventId = `evt_${randomUUID()}`;
    await Promise.all([
      deleteAccount(database, eventId, identity),
      deleteAccount(database, eventId, identity),
    ]);
    await expect(resolveOwner(database, identity)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (
        await temporary.pool.query(
          'SELECT event_id FROM webhook_events WHERE event_id=$1',
          [eventId],
        )
      ).rowCount,
    ).toBe(1);
  });
  it('revokes sharing immediately and schedules durable cleanup once', async () => {
    const owner = await resolveOwner(database, `user_${randomUUID()}`);
    const screenshotId = randomUUID();
    const objectKey = `originals/${screenshotId}.png`;
    const previewKey = `previews/${screenshotId}.png`;
    await temporary.pool.query(
      `INSERT INTO screenshots (id,user_id,capture_id,title,object_key,mime_type,size_bytes,width,height,sha256,ocr_status,ocr_text,captured_at)
      VALUES ($1,$2,$3,'Fixture',$4,'image/png',10,10,10,$5,'complete','text',now())`,
      [screenshotId, owner.id, randomUUID(), objectKey, 'a'.repeat(64)],
    );
    await temporary.pool.query(
      `INSERT INTO screenshot_shares (user_id,screenshot_id,token_hash,public_title,preview_object_key) VALUES ($1,$2,$3,'Approved',$4)`,
      [owner.id, screenshotId, 'b'.repeat(64), previewKey],
    );
    const eventId = `evt_${randomUUID()}`;
    await deleteAccount(database, eventId, owner.clerkUserId);
    await deleteAccount(database, eventId, owner.clerkUserId);
    await expect(
      registerDevice(database, owner.id, {
        installationId: randomUUID(),
        name: 'Late',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await temporary.pool.query(
          'SELECT id FROM screenshot_shares WHERE user_id=$1 AND revoked_at IS NULL',
          [owner.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await temporary.pool.query(
          'SELECT id FROM screenshots WHERE user_id=$1 AND deleted_at IS NULL',
          [owner.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await temporary.pool.query(
          'SELECT object_key FROM cleanup_jobs WHERE user_id=$1',
          [owner.id],
        )
      ).rows
        .map((row) => row.object_key)
        .sort(),
    ).toEqual([objectKey, previewKey].sort());
  });
  it('verifies raw-body signatures, rejects forgeries, and deduplicates deliveries', async () => {
    const secret = `whsec_${Buffer.from('screenstash-test-signing-secret!!').toString('base64')}`;
    const app = createApp(
      parseEnvironment({ CLERK_WEBHOOK_SIGNING_SECRET: secret }),
      { database },
    );
    const identity = `user_${randomUUID()}`;
    const payload = JSON.stringify({
      type: 'user.deleted',
      data: { id: identity, deleted: true, object: 'user' },
      object: 'event',
    });
    const eventId = `msg_${randomUUID()}`;
    const timestamp = new Date();
    const signature = new Webhook(secret).sign(eventId, timestamp, payload);
    const send = (signatureValue: string) =>
      request(app)
        .post('/api/webhooks/clerk')
        .set('Content-Type', 'application/json')
        .set('svix-id', eventId)
        .set('svix-timestamp', String(Math.floor(timestamp.getTime() / 1000)))
        .set('svix-signature', signatureValue)
        .send(payload);
    expect((await send('v1,forged')).status).toBe(400);
    expect((await send(signature)).status).toBe(200);
    expect((await send(signature)).status).toBe(200);
    await expect(resolveOwner(database, identity)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('uses Clerk verification to reject expired, wrong-key and disallowed-party session JWTs as JSON', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const environment = parseEnvironment({
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('fixture.clerk.accounts.dev$').toString('base64')}`,
      CLERK_SECRET_KEY: 'sk_test_fixture',
      CLERK_JWT_KEY: pair.publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString(),
    });
    const app = createApp(environment, { database });
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      v: 2,
      sub: `user_${randomUUID()}`,
      sid: `sess_${randomUUID()}`,
      iss: 'https://fixture.clerk.accounts.dev',
      azp: 'http://localhost:3000',
      iat: now,
      nbf: now - 10,
      exp: now + 60,
      sts: 'active',
    };
    function token(
      patch: Record<string, unknown> = {},
      privateKey = pair.privateKey,
    ) {
      const value = [
        Buffer.from(
          JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fixture' }),
        ).toString('base64url'),
        Buffer.from(JSON.stringify({ ...payload, ...patch })).toString(
          'base64url',
        ),
      ].join('.');
      return `${value}.${sign('RSA-SHA256', Buffer.from(value), privateKey).toString('base64url')}`;
    }
    const accepted = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token()}`);
    expect(accepted.status).toBe(200);
    for (const rejected of [
      token({ exp: now - 60 }),
      token({ azp: 'https://foreign.example' }),
      token({}, other.privateKey),
    ]) {
      const response = await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${rejected}`);
      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers.location).toBeUndefined();
    }
  });
});
