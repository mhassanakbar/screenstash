import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { test, expect, _electron as electron } from '@playwright/test';
import sharp from 'sharp';

test('Windows Print Screen setup opens only keyboard settings and persists opt-in across restart', async () => {
  const profile = path.resolve(
    'test-results',
    `shortcut-acceptance-${randomUUID()}`,
  );
  await mkdir(profile, { recursive: true });
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
    await page
      .getByRole('button', { name: 'Set up Print Screen', exact: true })
      .click();
    await expect(
      page.getByText('Turn off “Use the Print Screen button'),
    ).toBeVisible();
    // Intercept the OS launch so automated acceptance never changes user settings.
    await application.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        (globalThis as unknown as { settingsUrl: string }).settingsUrl = url;
      };
    });
    await page
      .getByRole('button', {
        name: 'Open Windows keyboard settings',
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        application.evaluate(
          () => (globalThis as unknown as { settingsUrl?: string }).settingsUrl,
        ),
      )
      .toBe('ms-settings:easeofaccess-keyboard');
    await page
      .getByRole('button', {
        name: 'Enable Print Screen shortcuts',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Retry Print Screen shortcuts',
        exact: true,
      }),
    ).toBeVisible();
    const enabled = await page.evaluate(() =>
      window.screenstash.captureState(),
    );
    expect(enabled.printScreen).toEqual({ supported: true, enabled: true });
    expect(enabled.shortcuts.map((value) => value.accelerator)).toEqual([
      'Control+Shift+1',
      'Control+Shift+2',
      'PrintScreen',
      'Shift+PrintScreen',
    ]);
    await page
      .getByRole('button', {
        name: 'Retry Print Screen shortcuts',
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole('region', { name: 'Print Screen shortcut setup' })
        .getByRole('status'),
    ).toContainText(/Print Screen shortcut/);
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page.context().setOffline(true);
    await expect(
      page.getByRole('button', {
        name: 'Disable Print Screen shortcuts',
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.screenstash.captureState())).printScreen
        .enabled,
    ).toBe(true);
    await page
      .getByRole('button', {
        name: 'Disable Print Screen shortcuts',
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.screenstash.captureState()))
            .shortcuts.length,
      )
      .toBe(2);
    expect(
      JSON.parse(
        await readFile(path.join(profile, 'capture-shortcuts.json'), 'utf8'),
      ),
    ).toEqual({ printScreenEnabled: false });
  } finally {
    await application.close();
  }
});

test('packaged offline display/region capture saves exact pixels, cancels safely and survives restart', async () => {
  test.setTimeout(90000);
  const profile = path.resolve(
    'test-results',
    `capture-acceptance-${randomUUID()}`,
  );
  await mkdir(profile, { recursive: true });
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
    await expect(
      page.getByRole('button', { name: 'Capture display', exact: true }),
    ).toBeVisible();
    await page.context().setOffline(true);
    const display = await application.evaluate(
      async ({ BrowserWindow, screen }) => {
        const display = screen.getDisplayNearestPoint(
          screen.getCursorScreenPoint(),
        );
        const fixture = new BrowserWindow({
          ...display.bounds,
          fullscreen: true,
          frame: false,
          alwaysOnTop: true,
          show: false,
          backgroundColor: '#228844',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        await fixture.loadURL(
          'data:text/html,' +
            encodeURIComponent(
              '<style>html,body{margin:0;background:rgb(34,136,68);width:100%;height:100%}div{position:absolute;left:80px;top:80px;width:160px;height:120px;background:rgb(220,40,50)}</style><div></div>',
            ),
        );
        (globalThis as unknown as { captureFixture: unknown }).captureFixture =
          fixture;
        fixture.show();
        fixture.focus();
        await fixture.webContents.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        );
        console.log(
          'Fixture bounds match target:',
          JSON.stringify(fixture.getBounds()) ===
            JSON.stringify(display.bounds),
          'visible:',
          fixture.isVisible(),
        );
        return {
          width: display.bounds.width,
          height: display.bounds.height,
          scale: display.scaleFactor,
        };
      },
    );
    // Wait for the real Windows compositor; the source is not mocked.
    await page.waitForTimeout(400);
    expect(
      await application.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith('/index.html'),
        )!;
        main.setAlwaysOnTop(true);
        main.show();
        main.focus();
        return main.isVisible();
      }),
    ).toBe(true);
    await page.waitForTimeout(200);
    const full = await page.evaluate(() =>
      window.screenstash.capture('display'),
    );
    expect(full.status).toBe('saved');
    if (full.status !== 'saved')
      throw new Error('Display capture did not save');
    expect(full.capture).toMatchObject({
      width: Math.round(display.width * display.scale),
      height: Math.round(display.height * display.scale),
      assigned: false,
      mode: 'display',
    });
    const original = await readFile(
      path.join(profile, 'captures', `${full.capture.id}.png`),
    );
    const pixel = await sharp(original)
      .extract({
        left: Math.round(20 * display.scale),
        top: Math.round(20 * display.scale),
        width: 1,
        height: 1,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixel]).toEqual([34, 136, 68]);
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) =>
            window.webContents.getURL().endsWith('/index.html'),
          )!
          .isVisible(),
      ),
    ).toBe(true);
    await expect(page.locator('.capture-list li')).toHaveCount(1);
    const windowCreated = application.waitForEvent('window');
    const pending = page
      .evaluate(() => window.screenstash.capture('region'))
      .catch(() => null);
    const overlay = await windowCreated;
    await expect(overlay.locator('#frame')).toHaveJSProperty(
      'naturalWidth',
      full.capture.width,
    );
    expect(
      await overlay.evaluate(() => ({
        node: typeof (window as unknown as { require?: unknown }).require,
        main: typeof window.screenstash,
      })),
    ).toEqual({ node: 'undefined', main: 'undefined' });
    await expect
      .poll(() =>
        overlay.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
        })),
      )
      .toEqual({ width: display.width, height: display.height });
    expect(
      await page.evaluate(() => window.screenstash.capture('display')),
    ).toEqual({ status: 'failed', code: 'CAPTURE_BUSY' });
    const rejected = await overlay.evaluate(async () => {
      const context = await window.screenstashRegion.context();
      try {
        await window.screenstashRegion.select({
          id: context.id,
          rectangle: { x: -50, y: 0, width: 100, height: 50 },
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toBe(true);
    await overlay.mouse.move(240, 200);
    await overlay.mouse.down();
    await overlay.mouse.move(80, 80, { steps: 8 });
    await overlay.mouse.up();
    const cropped = await pending;
    if (!cropped) throw new Error('Capture operation was interrupted');
    expect(cropped.status).toBe('saved');
    if (cropped.status !== 'saved')
      throw new Error('Region capture did not save');
    expect(cropped.capture).toMatchObject({
      mode: 'region',
      width: Math.round(160 * display.scale),
      height: Math.round(120 * display.scale),
    });
    const crop = await readFile(
      path.join(profile, 'captures', `${cropped.capture.id}.png`),
    );
    const cropPixel = await sharp(crop)
      .extract({ left: 10, top: 10, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...cropPixel]).toEqual([220, 40, 50]);
    const cancelledWindow = application.waitForEvent('window');
    const cancelled = page
      .evaluate(() => window.screenstash.capture('region'))
      .catch(() => null);
    const cancelOverlay = await cancelledWindow;
    await expect
      .poll(() =>
        cancelOverlay
          .locator('#frame')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await cancelOverlay.keyboard.press('Escape').catch((error) => {
      // The main process destroys the selector as soon as Escape is handled.
      if (!cancelOverlay.isClosed()) throw error;
    });
    expect(await cancelled).toEqual({ status: 'cancelled' });
    expect(
      (await page.evaluate(() => window.screenstash.captureState())).captures,
    ).toHaveLength(2);
    expect(
      (await readdir(path.join(profile, 'captures'))).filter((name) =>
        name.endsWith('.png'),
      ),
    ).toHaveLength(2);
    const changedWindow = application.waitForEvent('window');
    const changed = page
      .evaluate(() => window.screenstash.capture('region'))
      .catch(() => null);
    const changedOverlay = await changedWindow;
    await expect
      .poll(() =>
        changedOverlay
          .locator('#frame')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await application.evaluate(({ screen }) => {
      const getDisplays = screen.getAllDisplays;
      try {
        screen.getAllDisplays = () => [];
        screen.emit('display-removed', {}, screen.getPrimaryDisplay());
      } finally {
        screen.getAllDisplays = getDisplays;
      }
    });
    expect(await changed).toEqual({
      status: 'failed',
      code: 'DISPLAY_CHANGED',
    });
    await application.evaluate(({ powerMonitor }) =>
      powerMonitor.emit('lock-screen'),
    );
    expect(
      await page.evaluate(() => window.screenstash.capture('display')),
    ).toEqual({ status: 'failed', code: 'SCREEN_LOCKED' });
    await application.evaluate(({ powerMonitor }) =>
      powerMonitor.emit('unlock-screen'),
    );
    expect(
      (await page.evaluate(() => window.screenstash.captureState())).captures,
    ).toHaveLength(2);
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page.context().setOffline(true);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.screenstash.captureState()))
            .captures.length,
      )
      .toBe(2);
    expect(
      await readFile(
        path.join(profile, 'captures', `${cropped.capture.id}.png`),
      ),
    ).toEqual(crop);
    console.log(
      `Real capture acceptance: ${full.capture.width} × ${full.capture.height}, region ${cropped.capture.width} × ${cropped.capture.height}, ${Math.round(display.scale * 100)}% DPI; offline restart and cancellation passed.`,
    );
  } finally {
    await application.close();
  }
});
