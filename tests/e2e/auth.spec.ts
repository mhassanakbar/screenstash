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
  browser,
}) => {
  test.setTimeout(180000);
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
        await page
          .getByLabel('Screenshot title', { exact: true })
          .fill('Renamed browser fixture');
        await page
          .getByLabel('New tag', { exact: true })
          .fill('Acceptance tag');
        await page
          .getByRole('button', { name: 'Add tag', exact: true })
          .click();
        await expect(
          page.getByRole('checkbox', { name: 'Acceptance tag' }),
        ).toBeChecked();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(
          page.getByText('Changes saved.', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('dialog', { name: 'Renamed browser fixture' }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(
          page.getByRole('button', { name: 'Open Renamed browser fixture' }),
        ).toBeFocused();
        await page
          .getByRole('searchbox', { name: 'Search screenshots' })
          .fill('Synthetic');
        await expect(page).toHaveURL(/q=Synthetic/);
        await expect(
          page.getByRole('button', { name: 'Open Renamed browser fixture' }),
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Acceptance tag', exact: true })
          .click();
        await expect(
          page.getByRole('button', { name: 'Acceptance tag', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        await page.reload();
        await expect(
          page.getByRole('searchbox', { name: 'Search screenshots' }),
        ).toHaveValue('Synthetic');
        await expect(
          page.getByRole('button', { name: 'Acceptance tag', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        const today = new Date().toISOString().slice(0, 10);
        await page.getByLabel('From (UTC)', { exact: true }).fill(today);
        await expect(page).toHaveURL(/from=/);
        await expect(
          page.getByRole('button', { name: 'Open Renamed browser fixture' }),
        ).toBeVisible();
        await page.getByLabel('Before (UTC)', { exact: true }).fill(today);
        await expect(
          page
            .getByRole('alert')
            .filter({ hasText: 'These filters are invalid.' }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Clear filters' }).click();
        await expect(page).toHaveURL(/\/vault$/);
        await page
          .getByRole('searchbox', { name: 'Search screenshots' })
          .fill('doesnotexist');
        await expect(
          page.getByRole('heading', { name: 'No matching screenshots' }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Clear filters' }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(
          page.getByRole('button', { name: 'Open Renamed browser fixture' }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
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
        headers.Authorization = `Bearer ${await page.evaluate(() => window.Clerk.session!.getToken())}`;
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
          .getByRole('button', { name: 'Open Renamed browser fixture' })
          .click();
        await page
          .getByLabel('Public title', { exact: true })
          .fill('Approved browser share');
        await page
          .getByRole('button', { name: 'Create public link', exact: true })
          .click();
        const link = page.getByLabel('Public link', { exact: true });
        await expect(link).toBeVisible();
        const firstUrl = await link.inputValue();
        const publicContext = await browser.newContext();
        try {
          const publicPage = await publicContext.newPage();
          const publicResponse = await publicPage.goto(firstUrl);
          expect(publicResponse?.status()).toBe(200);
          await expect(
            publicPage.getByRole('heading', { name: 'Approved browser share' }),
          ).toBeVisible();
          await expect(
            publicPage.getByRole('img', { name: 'Approved browser share' }),
          ).toBeVisible();
          const tokenPath = new URL(firstUrl).pathname;
          for (const agent of [
            'Mozilla/5.0',
            'Discordbot/2.0',
            'Twitterbot/1.0',
          ]) {
            const html = await publicContext.request.get(firstUrl, {
              headers: { 'User-Agent': agent },
            });
            expect(html.status()).toBe(200);
            expect(html.headers()['cache-control']).toContain('no-store');
            const text = await html.text();
            // Keep the public-link token out of assertion output.
            const redacted = text.replaceAll(
              tokenPath.split('/').at(-1)!,
              '[share-token]',
            );
            expect(redacted).toContain(
              'property="og:title" content="Approved browser share"',
            );
            expect(redacted).toContain(
              'property="og:site_name" content="ScreenStash"',
            );
            expect(redacted).toContain(
              'name="twitter:card" content="summary_large_image"',
            );
            expect(redacted).toContain(
              'property="og:image:width" content="1200"',
            );
            expect(redacted).toContain(
              'property="og:image:height" content="630"',
            );
            expect(redacted).not.toMatch(
              /Renamed browser fixture|Synthetic browser fixture|Acceptance tag|clerkUserId|ClerkProvider/,
            );
          }
          const preview = await publicContext.request.get(
            `${firstUrl}/preview.jpg`,
          );
          expect(preview.status()).toBe(200);
          expect(preview.headers()['content-type']).toBe('image/jpeg');
          expect(await sharp(await preview.body()).metadata()).toMatchObject({
            width: 1200,
            height: 630,
            format: 'jpeg',
          });
          const publicImage = await publicContext.request.get(
            `${firstUrl}/image`,
          );
          expect(publicImage.status()).toBe(200);
          expect(
            createHash('sha256')
              .update(await publicImage.body())
              .digest('hex'),
          ).toBe(createHash('sha256').update(bytes).digest('hex'));
          expect((await publicContext.request.head(firstUrl)).status()).toBe(
            200,
          );
          expect(
            (await publicContext.request.head(`${firstUrl}/image`)).status(),
          ).toBe(200);
          await page.getByRole('button', { name: 'Close screenshot' }).click();
          await page
            .getByRole('button', { name: 'Open Renamed browser fixture' })
            .click();
          await expect(
            page.getByText('The link is shown only when created.', {
              exact: false,
            }),
          ).toBeVisible();
          await expect(
            page.getByLabel('Public link', { exact: true }),
          ).not.toBeVisible();
          await page
            .getByLabel('Public title', { exact: true })
            .fill('Approved replacement');
          await page
            .getByRole('button', { name: 'Replace link', exact: true })
            .click();
          await page
            .getByRole('button', { name: 'Confirm replacement' })
            .click();
          await expect(link).toBeVisible();
          const secondUrl = await link.inputValue();
          expect(firstUrl === secondUrl).toBe(false);
          for (const suffix of ['', '/image', '/preview.jpg']) {
            const revoked = await publicContext.request.get(
              `${firstUrl}${suffix}`,
            );
            expect(revoked.status()).toBe(404);
            expect(
              (
                await publicContext.request.head(`${firstUrl}${suffix}`)
              ).status(),
            ).toBe(404);
            if (!suffix)
              expect(await revoked.text()).not.toContain('property="og:image"');
          }
          expect((await publicContext.request.get(secondUrl)).status()).toBe(
            200,
          );
          await page
            .getByRole('button', { name: 'Revoke link', exact: true })
            .click();
          await expect(
            page.getByRole('button', {
              name: 'Create public link',
              exact: true,
            }),
          ).toBeVisible();
          for (const suffix of ['', '/image', '/preview.jpg'])
            expect(
              (
                await publicContext.request.get(`${secondUrl}${suffix}`)
              ).status(),
            ).toBe(404);
          await page
            .getByRole('button', { name: 'Create public link', exact: true })
            .click();
          await expect(link).toBeVisible();
          const deletionUrl = await link.inputValue();
          await page.getByRole('button', { name: 'Delete screenshot' }).click();
          await page
            .getByRole('button', { name: 'Delete permanently' })
            .click();
          await expect(page.getByRole('dialog')).not.toBeVisible();
          for (const suffix of ['', '/image', '/preview.jpg'])
            expect(
              (
                await publicContext.request.get(`${deletionUrl}${suffix}`)
              ).status(),
            ).toBe(404);
          expect((await publicContext.request.get('/s/invalid')).status()).toBe(
            404,
          );
        } finally {
          await publicContext.close();
        }
        await expect(page.getByRole('dialog')).not.toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Open Renamed browser fixture' }),
        ).not.toBeVisible();
        expect(
          (await page.request.get(`/api/screenshots/${id}/image`)).status(),
        ).toBe(404);
        headers.Authorization = `Bearer ${await page.evaluate(() => window.Clerk.session!.getToken())}`;
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
    const cleanupFailures: string[] = [];
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
      } catch {
        cleanupFailures.push('Local fixture cleanup failed.');
      } finally {
        await connection.pool.end();
      }
    }
    const results = await Promise.allSettled(
      users.map((id) => provider.users.deleteUser(id)),
    );
    if (results.some((result) => result.status === 'rejected'))
      cleanupFailures.push(
        'A disposable Clerk test account could not be removed.',
      );
    if (cleanupFailures.length) throw new Error(cleanupFailures.join(' '));
  }
});
