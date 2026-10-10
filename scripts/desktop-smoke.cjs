/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { app, session } = require('electron');

const root = path.resolve(__dirname, '..');
const archive = path.join(
  root,
  'apps/desktop/out/ScreenStash-win32-x64/resources/app.asar',
);
const profile = path.join(root, 'test-results', `desktop-smoke-${Date.now()}`);
mkdirSync(profile, { recursive: true });
process.env.SCREENSTASH_ACCEPTANCE = '1';
process.env.SCREENSTASH_ACCEPTANCE_DATA = profile;
const timeout = setTimeout(() => {
  console.error('Desktop smoke test timed out');
  app.exit(1);
}, 20000);

// Exercise local startup with the remote authentication service unavailable.
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['https://*/*', 'http://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
});
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('preload-error', () => {
    console.error('Packaged preload failed');
    app.exit(1);
  });
  window.webContents.once('did-finish-load', async () => {
    try {
      let result;
      for (let attempt = 0; attempt < 30; attempt++) {
        result = await window.webContents.executeJavaScript(
          '({ title: document.title, ready: !!document.querySelector("h1"), appName: window.screenstash?.appName, nodeType: typeof require })',
        );
        if (result.ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(result.title, 'ScreenStash');
      assert.equal(result.ready, true);
      assert.equal(result.appName, 'ScreenStash');
      assert.equal(result.nodeType, 'undefined');
      assert.equal(
        window.webContents.getURL(),
        'screenstash://renderer/index.html',
      );
      await window.webContents.executeJavaScript(
        'window.screenstash.configuration()',
      );
      console.log(
        'PASS: ASAR main bootstrap, local protocol, sandboxed preload, and offline renderer.',
      );
      clearTimeout(timeout);
      app.quit();
    } catch {
      console.error('Desktop bootstrap verification failed');
      app.exit(1);
    }
  });
});
// Load the actual built entry, including Clerk and encrypted storage initialization.
require(path.join(archive, '.vite/build/main.cjs'));
