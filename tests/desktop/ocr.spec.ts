import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import sharp from 'sharp';

test('fresh packaged profile recognizes offline and keeps its queue in the tray', async () => {
  test.setTimeout(120000);
  const profile = path.resolve('test-results', 'offline-ocr-' + randomUUID());
  const id = randomUUID();
  await mkdir(path.join(profile, 'captures'), { recursive: true });
  const bytes = await sharp(
    Buffer.from(
      '<svg width="1800" height="220"><rect width="100%" height="100%" fill="white"/><text x="40" y="130" font-family="Arial" font-size="64" fill="black">SCREENSTASH OFFLINE INVOICE 4729</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  await writeFile(path.join(profile, 'captures', id + '.png'), bytes);
  const launch = () =>
    electron.launch({
      executablePath: path.resolve(
        'apps/desktop/out/ScreenStash-win32-x64/ScreenStash.exe',
      ),
      env: {
        ...process.env,
        SCREENSTASH_ACCEPTANCE: '1',
        SCREENSTASH_ACCEPTANCE_DATA: profile,
      },
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await page.context().setOffline(true);
    await expect
      .poll(
        async () => {
          try {
            return JSON.parse(
              await readFile(path.join(profile, 'queue', id + '.json'), 'utf8'),
            ).ocrStatus;
          } catch {
            return null;
          }
        },
        { timeout: 90000 },
      )
      .toBe('complete');
    const manifest = JSON.parse(
      await readFile(path.join(profile, 'queue', id + '.json'), 'utf8'),
    );
    expect(manifest.ocrText).toContain('OFFLINE INVOICE 4729');
    expect(manifest.identity).toBeNull();
    expect(manifest.uploadStatus).toBe('pending');
    const settings = await page.evaluate(() =>
      (
        window.screenstash as typeof window.screenstash & {
          updateSettings(patch: { paused: boolean }): Promise<unknown>;
        }
      ).updateSettings({ paused: true }),
    );
    expect(settings).toMatchObject({ paused: true });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.close();
    });
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    ).toBe(false);
    expect(
      await page.evaluate(() => window.screenstash.configuration()),
    ).toMatchObject({ packaged: true });
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window.screenstash as typeof window.screenstash & {
              settings(): Promise<{ paused: boolean }>;
            }
          ).settings(),
        ),
      )
      .toMatchObject({ paused: true });
    expect(
      JSON.parse(
        await readFile(path.join(profile, 'queue', id + '.json'), 'utf8'),
      ).ocrText,
    ).toBe(manifest.ocrText);
  } finally {
    await application.close();
  }
});
