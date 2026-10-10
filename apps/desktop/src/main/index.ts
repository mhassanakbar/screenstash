import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { createClerkBridge } from '@clerk/electron';
import { storage } from '@clerk/electron/storage';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApiClient } from '@screenstash/api-client';
import started from 'electron-squirrel-startup';
import {
  bridgeChannels,
  configurationSchema,
  identitySchema,
} from '../contracts/bridge';
import {
  trustedRendererUrl,
  resolveRendererAsset,
  fileResponseUrl,
  configuredHttpOrigin,
  rendererOrigin,
} from './security';
import { TokenBroker } from './auth/broker';
import { probeDisplay } from './capture/probe';

app.setName('ScreenStash');
if (
  process.env.SCREENSTASH_ACCEPTANCE === '1' &&
  process.env.SCREENSTASH_ACCEPTANCE_DATA
)
  app.setPath('userData', process.env.SCREENSTASH_ACCEPTANCE_DATA);
const primary = !started && app.requestSingleInstanceLock();
if (!primary) app.quit();
let window: BrowserWindow | undefined;
const developmentUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const developmentServices =
  !app.isPackaged || !publishableKey || publishableKey.startsWith('pk_test_');
const apiOrigin = configuredHttpOrigin(
  import.meta.env.VITE_API_ORIGIN ?? 'http://127.0.0.1:4000',
  developmentServices,
);
const webOrigin = configuredHttpOrigin(
  import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:3000',
  developmentServices,
);
const frontendHost = import.meta.env.VITE_CLERK_FRONTEND_API_HOST;
const authenticationConfigured = Boolean(
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY &&
  frontendHost &&
  /^[a-z0-9.-]+$/i.test(frontendHost),
);
const broker = new TokenBroker(() => window?.webContents);
let probeRunning = false;
function trusted(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !trustedRendererUrl(event.senderFrame.url, developmentUrl)
  )
    throw new Error('This request is not allowed.');
}
function registerHandler(
  channel: string,
  operation: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    try {
      return await operation(event, ...args);
    } catch {
      throw new Error(
        'The operation could not be completed. Please try again.',
      );
    }
  });
}
if (primary) {
  // Guard the SDK's main-frame handlers with this application's window and origin boundary.
  const handle = ipcMain.handle;
  ipcMain.handle = (channel, listener) =>
    handle.call(ipcMain, channel, (event, ...args) => {
      trusted(event);
      return listener(event, ...args);
    });
  let clerk: ReturnType<typeof createClerkBridge>;
  try {
    clerk = createClerkBridge({
      storage: storage({ unencryptedFallback: false }),
      renderer: {
        scheme: 'screenstash',
        host: 'renderer',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
      manageSingleInstanceLock: false,
      userAgent: `ScreenStash/${app.getVersion()}`,
    });
  } finally {
    ipcMain.handle = handle;
  }
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  app.on('before-quit', () => {
    broker.invalidate();
    clerk.cleanup();
  });
  void app
    .whenReady()
    .then(async () => {
      const root = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
      protocol.handle('screenstash', async (request) => {
        try {
          return await net.fetch(
            fileResponseUrl(resolveRendererAsset(root, request.url)),
          );
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      const clerkSources = authenticationConfigured
        ? ` https://${frontendHost} https://challenges.cloudflare.com https://*.protect.clerk.com`
        : '';
      const policy = [
        `default-src 'self'`,
        `script-src 'self' 'unsafe-inline'${clerkSources}`,
        `style-src 'self' 'unsafe-inline'`,
        `connect-src 'self'${clerkSources} https://clerk-telemetry.com https://*.clerk-telemetry.com${developmentUrl ? ' http://localhost:5173 ws://localhost:5173' : ''}`,
        `img-src 'self' data: https://img.clerk.com`,
        `frame-src 'self'${clerkSources}`,
        `worker-src 'self' blob:`,
        `form-action 'self'`,
        `object-src 'none'`,
        `base-uri 'self'`,
      ].join('; ');
      session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            ...(details.resourceType === 'mainFrame'
              ? { 'Content-Security-Policy': [policy] }
              : {}),
          },
        }),
      );
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      const api = createApiClient({
        baseUrl: apiOrigin,
        getSessionToken: () => broker.request(),
      });
      registerHandler(bridgeChannels.configuration, () =>
        configurationSchema.parse({
          authenticationConfigured,
          packaged: app.isPackaged,
          version: app.getVersion(),
        }),
      );
      registerHandler(bridgeChannels.invalidate, () => {
        broker.invalidate();
      });
      registerHandler(bridgeChannels.authenticate, async () => {
        const epoch = broker.epoch();
        const owner = await api.me(AbortSignal.timeout(15000));
        if (epoch !== broker.epoch()) throw new Error('Identity changed');
        const file = path.join(app.getPath('userData'), 'installation-id');
        let installationId: string;
        try {
          installationId = (await readFile(file, 'utf8')).trim();
          if (!/^[a-f0-9-]{36}$/i.test(installationId)) throw new Error();
        } catch {
          installationId = randomUUID();
          await writeFile(file, installationId);
        }
        const device = await api.registerDevice(
          { installationId, name: 'Windows desktop' },
          AbortSignal.timeout(15000),
        );
        if (epoch !== broker.epoch()) throw new Error('Identity changed');
        return identitySchema.parse({ owner, device });
      });
      registerHandler(bridgeChannels.openVault, () =>
        shell.openExternal(new URL('/vault', webOrigin).href),
      );
      registerHandler(bridgeChannels.probeCapture, async () => {
        if (probeRunning) throw new Error('Capture is busy');
        probeRunning = true;
        const visible = window?.isVisible();
        window?.hide();
        try {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return await probeDisplay();
        } finally {
          probeRunning = false;
          if (visible) window?.show();
        }
      });
      registerHandler(bridgeChannels.tokenReply, (_event, reply) =>
        broker.accept(reply),
      );
      window = new BrowserWindow({
        width: 1000,
        height: 760,
        minWidth: 680,
        minHeight: 520,
        title: 'ScreenStash',
        show: process.env.SCREENSTASH_ACCEPTANCE !== '1',
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (!trustedRendererUrl(url, developmentUrl)) event.preventDefault();
      });
      window.webContents.on('will-redirect', (event, url) => {
        if (!trustedRendererUrl(url, developmentUrl)) event.preventDefault();
      });
      window.webContents.on('render-process-gone', () => broker.invalidate());
      window.webContents.on('destroyed', () => broker.invalidate());
      await window.loadURL(developmentUrl ?? `${rendererOrigin}/index.html`);
    })
    .catch(() => {
      console.error(
        'ScreenStash could not start. Check desktop configuration.',
      );
      app.quit();
    });
}
app.on('window-all-closed', () => app.quit());
