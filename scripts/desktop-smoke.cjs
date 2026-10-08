/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const archive = path.join(
  root,
  'apps/desktop/out/ScreenStash-win32-x64/resources/app.asar',
);
const timeout = setTimeout(() => {
  console.error('Desktop smoke test timed out');
  app.exit(1);
}, 20000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(archive, '.vite/build/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    console.error('Packaged preload failed:', error);
  });
  try {
    await window.loadFile(
      path.join(archive, '.vite/renderer/main_window/index.html'),
    );
    const result = await window.webContents.executeJavaScript(
      '({ title: document.title, text: document.body.innerText, appName: window.screenstash?.appName, nodeType: typeof require })',
    );
    assert.equal(result.title, 'ScreenStash');
    assert.match(result.text, /The Electron application is ready/);
    assert.equal(result.appName, 'ScreenStash');
    assert.equal(result.nodeType, 'undefined');
    console.log(
      'PASS: packaged Electron renderer, sandboxed preload bridge, and Node isolation.',
    );
    clearTimeout(timeout);
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
