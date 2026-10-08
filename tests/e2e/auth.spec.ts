import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { uploadSessionSchema } from '@screenstash/shared';
import { createDatabase } from '@screenstash/db';
import { deleteAccount } from '../../apps/api/src/webhooks/clerk.js';
import { parseEnvironment } from '../../apps/api/src/config/environment.js';
import { createObjectStore } from '../../apps/api/src/storage/r2.js';
import { test, expect } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import { clerk } from '@clerk/testing/playwright';

test.use({ trace: 'off' });
test('real Clerk sessions authorize distinct vaults and sign-out removes access', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey?.startsWith('sk_test_'))
    throw new Error('Development Clerk credentials are required.');
  const provider = createClerkClient({ secretKey });
  const users: string[] = [];
  const ownerIds: string[] = [];
  try {
    expect((await request.get('/api/me')).status()).toBe(401);
    expect(
      (
        await request.get('/api/me', {
          headers: { Authorization: 'Bearer invalid' },
        })
      ).status(),
    ).toBe(401);
    for (let i = 0; i < 2; i++) {
      const emailAddress = `screenstash-${randomUUID()}+clerk_test@example.com`;
      const user = await provider.users.createUser({
        emailAddress: [emailAddress],
        skipPasswordRequirement: true,
      });
      users.push(user.id);
      const signInPage = await page.goto('/sign-in');
      expect(signInPage?.status()).toBe(200);
      await clerk.signIn({ page, emailAddress });
      await page.goto('/vault');
      await expect(
        page.getByRole('heading', { name: 'Your account is connected.' }),
      ).toBeVisible({ timeout: 30000 });
      const account = await page.evaluate(async () => {
        const token = await window.Clerk.session!.getToken();
        const response = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        return {
          status: response.status,
          body: (await response.json()) as { id: string; clerkUserId: string },
        };
      });
      expect(account.status).toBe(200);
      expect(account.body.clerkUserId).toBe(user.id);
      ownerIds.push(account.body.id);
      if (i === 0) {
        // This padded PNG exercises the full 20 MiB streaming limit; Sharp still decodes its pixels.
        const png = await sharp({
          create: { width: 16, height: 10, channels: 4, background: '#168d70' },
        })
          .png()
          .toBuffer();
        const bytes = Buffer.concat([
          png,
          Buffer.alloc(20 * 1024 * 1024 - png.length),
        ]);
        const token = await page.evaluate(() =>
          window.Clerk.session!.getToken(),
        );
        const headers = { Authorization: `Bearer ${token}` };
        const captureId = randomUUID();
        const response = await request.post('/api/upload-sessions', {
          headers,
          data: {
            captureId,
            title: 'Browser streaming fixture',
            capturedAt: new Date().toISOString(),
            mimeType: 'image/png',
            sizeBytes: bytes.length,
            width: 16,
            height: 10,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            ocrStatus: 'complete',
            ocrText: 'Synthetic browser fixture',
          },
        });
        expect(response.status()).toBe(200);
        const upload = uploadSessionSchema.parse(await response.json());
        expect(
          (
            await fetch(upload.putUrl!, {
              method: 'PUT',
              headers: upload.requiredHeaders ?? {},
              body: new Uint8Array(bytes),
              signal: AbortSignal.timeout(30000),
            })
          ).ok,
        ).toBe(true);
        const finalized = await request.post(
          `/api/upload-sessions/${upload.id}/finalize`,
          { headers, data: {} },
        );
        expect(finalized.status()).toBe(200);
        const id = upload.screenshotId;
        await page.reload();
        await page
          .getByRole('button', { name: 'Open Browser streaming fixture' })
          .click();
        await expect(
          page.getByRole('dialog', { name: 'Browser streaming fixture' }),
        ).toBeVisible();
        await expect(
          page.getByText('Synthetic browser fixture', { exact: true }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        const image = await page.request.get(`/api/screenshots/${id}/image`);
        expect(image.status()).toBe(200);
        expect(
          createHash('sha256')
            .update(await image.body())
            .digest('hex'),
        ).toBe(createHash('sha256').update(bytes).digest('hex'));
        const head = await page.request.head(`/api/screenshots/${id}/image`);
        expect(head.status()).toBe(200);
        expect(Number(head.headers()['content-length'])).toBe(bytes.length);
        const direct = await fetch(
          `http://127.0.0.1:4000/api/screenshots/${id}/download`,
          { headers },
        );
        expect(direct.status).toBe(200);
        expect(direct.headers.get('content-disposition')).toContain(
          'attachment',
        );
        expect(
          createHash('sha256')
            .update(Buffer.from(await direct.arrayBuffer()))
            .digest('hex'),
        ).toBe(createHash('sha256').update(bytes).digest('hex'));
        await page
          .getByRole('button', { name: 'Open Browser streaming fixture' })
          .click();
        await page.getByRole('button', { name: 'Delete screenshot' }).click();
        await page.getByRole('button', { name: 'Delete permanently' }).click();
        await expect(page.getByRole('dialog')).not.toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Open Browser streaming fixture' }),
        ).not.toBeVisible();
        expect(
          (await page.request.get(`/api/screenshots/${id}/image`)).status(),
        ).toBe(404);
        expect(
          (
            await request.post(`/api/upload-sessions/${upload.id}/finalize`, {
              headers,
              data: {},
            })
          ).status(),
        ).toBe(409);
      }
      // Browser cookies alone cannot authorize JSON mutations.
      const mutationStatus = await page.evaluate(
        async () =>
          (
            await fetch('/api/devices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            })
          ).status,
      );
      expect(mutationStatus).toBe(401);
      await clerk.signOut({ page });
      await page.goto('/vault');
      await expect(page).toHaveURL(/\/sign-in/);
    }
    expect(new Set(ownerIds).size).toBe(2);
  } finally {
    // Real webhook delivery is configured separately; remove only these synthetic accounts' local data.
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl && users.length) {
      const connection = createDatabase(databaseUrl);
      try {
        const store = createObjectStore(parseEnvironment(process.env));
        for (const id of users) {
          await deleteAccount(connection.db, `e2e_cleanup_${randomUUID()}`, id);
          const jobs = await connection.pool.query(
            'SELECT object_key FROM cleanup_jobs JOIN users ON users.id=cleanup_jobs.user_id WHERE users.clerk_user_id=$1',
            [id],
          );
          if (store)
            for (const job of jobs.rows) await store.remove(job.object_key);
        }
      } finally {
        await connection.pool.end();
      }
    }
    const results = await Promise.allSettled(
      users.map((id) => provider.users.deleteUser(id)),
    );
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('A disposable Clerk test account could not be removed.');
  }
});
