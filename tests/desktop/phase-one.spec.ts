import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import { createDatabase } from '@screenstash/db';
import { deleteAccount } from '../../apps/api/src/webhooks/clerk';

test('packaged auth persistence, trusted IPC and native display frame', async ({
  request,
}) => {
  test.setTimeout(180000);
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (
    !secretKey?.startsWith('sk_test_') ||
    !publishableKey?.startsWith('pk_test_')
  )
    throw new Error('Development Clerk credentials required');
  const clerk = createClerkClient({
    secretKey,
    publishableKey,
  });
  const user = await clerk.users.createUser({
    emailAddress: [`desktop-${randomUUID()}+clerk_test@example.com`],
    skipPasswordRequirement: true,
  });
  const directory = path.resolve('test-results', `desktop-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const launch = () =>
    electron.launch({
      executablePath: path.resolve(
        'apps/desktop/out/ScreenStash-win32-x64/ScreenStash.exe',
      ),
      args: [],
      env: {
        ...process.env,
        SCREENSTASH_ACCEPTANCE: '1',
        SCREENSTASH_ACCEPTANCE_DATA: directory,
      },
    });
  let application: Awaited<ReturnType<typeof launch>> | undefined;
  let cleanupFailed: boolean;
  try {
    application = await launch();
    let page = await application.firstWindow();
    await expect(
      page.getByRole('heading', { name: 'ScreenStash', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe('undefined');
    const config = await page.evaluate(() =>
      window.screenstash.configuration(),
    );
    expect(config).toMatchObject({
      packaged: true,
      authenticationConfigured: true,
    });
    await page.waitForFunction(
      () =>
        !!(window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded,
      undefined,
      { timeout: 30000 },
    );
    const ticket = await clerk.signInTokens.createSignInToken({
      userId: user.id,
      expiresInSeconds: 60,
    });
    const signedIn = await page.evaluate(async (ticket) => {
      const provider = (
        window as unknown as {
          Clerk: {
            client: {
              signIn: {
                create: (input: {
                  strategy: 'ticket';
                  ticket: string;
                }) => Promise<{ status: string; createdSessionId: string }>;
              };
            };
            setActive: (input: { session: string }) => Promise<void>;
          };
        }
      ).Clerk;
      try {
        const result = await provider.client.signIn.create({
          strategy: 'ticket',
          ticket,
        });
        if (result.status !== 'complete') return false;
        await provider.setActive({ session: result.createdSessionId });
        return true;
      } catch {
        return false;
      }
    }, ticket.token);
    expect(signedIn).toBe(true);
    const claim = await page.evaluate(async () => {
      const token = await (
        window as unknown as {
          Clerk: { session: { getToken: () => Promise<string> } };
        }
      ).Clerk.session.getToken();
      const body = JSON.parse(
        atob(token.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/')),
      ) as { azp?: string };
      return {
        hasAuthorizedParty: Boolean(body.azp),
        expectedAuthorizedParty:
          !body.azp || body.azp === 'screenstash://renderer',
      };
    });
    console.log(
      `Native token has azp: ${claim.hasAuthorizedParty}; matches packaged renderer: ${claim.expectedAuthorizedParty}.`,
    );
    const nativeToken = await page.evaluate(() =>
      (
        window as unknown as {
          Clerk: { session: { getToken: () => Promise<string> } };
        }
      ).Clerk.session.getToken(),
    );
    const issued = JSON.parse(
      Buffer.from(nativeToken.split('.')[1]!, 'base64url').toString(),
    ) as { iat: number; exp: number };
    console.log(
      `Token issuance is ${issued.iat - Math.floor(Date.now() / 1000)} seconds ahead of the local system clock.`,
    );
    const state = await clerk.authenticateRequest(
      new Request('http://127.0.0.1:4000/api/me', {
        headers: { Authorization: `Bearer ${nativeToken}` },
      }),
      {
        authorizedParties: [
          'screenstash://renderer',
          'http://localhost:5173',
          'http://localhost:3000',
        ],
      },
    );
    console.log(
      `Native verifier: ${state.status}; reason: ${state.reason && /^[a-z-]+$/.test(state.reason) ? state.reason : 'none'}.`,
    );
    // Permit a short wait for this host's measured clock drift; do not weaken
    // JWT validation or rewrite token timestamps in the app or server.
    await expect
      .poll(
        async () =>
          (
            await request.get('http://127.0.0.1:4000/api/me', {
              headers: { Authorization: `Bearer ${nativeToken}` },
            })
          ).status(),
        {
          timeout: 15000,
          message: 'Native session must authenticate with Express',
        },
      )
      .toBe(200);
    expect(claim.expectedAuthorizedParty).toBe(true);
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(
      page.getByText('Your private vault is connected.', { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const owner = await page.evaluate(() => window.screenstash.authenticate());
    expect(owner.owner.clerkUserId).toBe(user.id);
    const capture = await page.evaluate(() =>
      window.screenstash.probeCapture(),
    );
    expect(capture.nativeResolution).toBe(true);
    console.log(
      `Display probe: ${capture.actualWidth} × ${capture.actualHeight}, ${Math.round(capture.scaleFactor * 100)}% scaling. Native token azp present: ${claim.hasAuthorizedParty}.`,
    );
    const forbidden = await application.evaluate(
      async ({ BrowserWindow, ipcMain }) => {
        const contents = BrowserWindow.getAllWindows()[0]!.webContents;
        // A subframe-shaped event must fail before a service call or token response.
        const event = {
          sender: contents,
          senderFrame: { url: 'https://untrusted.example' },
        };
        const handler = (
          ipcMain as unknown as {
            _invokeHandlers: Map<string, (event: unknown) => unknown>;
          }
        )._invokeHandlers.get('screenstash:configuration');
        try {
          await handler!(event);
          return false;
        } catch {
          return true;
        }
      },
    );
    expect(forbidden).toBe(true);
    const untilExpired = Math.max(0, issued.exp * 1000 - Date.now() + 6000);
    expect(untilExpired).toBeLessThan(90000);
    await new Promise((resolve) => setTimeout(resolve, untilExpired));
    await expect
      .poll(
        async () => {
          try {
            return (
              await page.evaluate(() => window.screenstash.authenticate())
            ).owner.id;
          } catch {
            return null;
          }
        },
        { timeout: 15000, intervals: [1000, 3000, 5000] },
      )
      .toBe(owner.owner.id);
    console.log(
      'Hidden renderer supplied a fresh session after the original JWT expired.',
    );
    await application.close();
    application = undefined;
    const encrypted = JSON.parse(
      await readFile(path.join(directory, 'clerk-tokens.json'), 'utf8'),
    ) as Record<string, unknown>;
    const values = Object.values(encrypted);
    expect(values.length).toBeGreaterThan(0);
    expect(
      values.every(
        (value) => typeof value === 'string' && value.startsWith('enc:'),
      ),
    ).toBe(true);
    application = await launch();
    page = await application.firstWindow();
    await expect(
      page.getByRole('button', { name: 'Reconnect', exact: true }),
    ).toBeVisible({ timeout: 45000 });
    await expect
      .poll(
        async () => {
          try {
            return (
              await page.evaluate(() => window.screenstash.authenticate())
            ).owner.id;
          } catch {
            return null;
          }
        },
        { timeout: 15000, intervals: [1000, 3000, 5000] },
      )
      .toBe(owner.owner.id);
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(
      page.getByText('Your private vault is connected.', { exact: true }),
    ).toBeVisible({ timeout: 45000 });
    expect(
      (await page.evaluate(() => window.screenstash.authenticate())).owner.id,
    ).toBe(owner.owner.id);
    await page.evaluate(async () => {
      await (
        window as unknown as { Clerk: { signOut: () => Promise<void> } }
      ).Clerk.signOut();
    });
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    const invalidated = await page.evaluate(async () => {
      try {
        await window.screenstash.authenticate();
        return false;
      } catch {
        return true;
      }
    });
    expect(invalidated).toBe(true);
  } finally {
    const cleanup = await Promise.allSettled([
      application ? application.close() : Promise.resolve(),
      (async () => {
        if (!process.env.DATABASE_URL) return;
        const database = createDatabase(process.env.DATABASE_URL);
        try {
          await deleteAccount(
            database.db,
            `desktop_cleanup_${randomUUID()}`,
            user.id,
          );
        } finally {
          await database.pool.end();
        }
      })(),
      clerk.users.deleteUser(user.id),
    ]);
    cleanupFailed = cleanup.some((result) => result.status === 'rejected');
    if (cleanupFailed)
      console.error(
        'Desktop acceptance fixture cleanup needs attention. No provider details were logged.',
      );
  }
  if (cleanupFailed)
    throw new Error('Desktop acceptance fixture cleanup failed.');
});
