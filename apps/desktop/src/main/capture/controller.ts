import {
  BrowserWindow,
  screen,
  session,
  net,
  ipcMain,
  powerMonitor,
  globalShortcut,
  type Display,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  captureChannels,
  regionSelectionSchema,
  captureStateSchema,
  type CaptureIdentity,
  type CaptureCode,
} from '../../contracts/capture';
import {
  resolveRendererAsset,
  fileResponseUrl,
  trustedRendererUrl,
} from '../security';
import { physicalRectangle } from './geometry';
import { CaptureError, captureDisplay } from './frame';
import type { CaptureRepository } from './repository';
import { CaptureShortcuts } from './shortcuts';

type Frame = Awaited<ReturnType<typeof captureDisplay>>;
export class CaptureController {
  private busy = false;
  private locked = false;
  private error: CaptureCode | null = null;
  private active:
    | {
        id: string;
        display: Display;
        frame: Frame;
        window: BrowserWindow;
        settle: (
          rectangle: ReturnType<typeof physicalRectangle> | null,
        ) => void;
      }
    | undefined;
  private shortcuts: CaptureShortcuts;
  constructor(
    private repository: CaptureRepository,
    private mainWindow: () => BrowserWindow | undefined,
    private assets: string,
    shortcutPreference: { read(): boolean; write(enabled: boolean): void },
    private developmentUrl?: string,
    private blocked: () => boolean = () => false,
  ) {
    this.shortcuts = new CaptureShortcuts(
      process.platform === 'win32',
      globalShortcut,
      (mode) => {
        void this.capture(mode);
      },
      shortcutPreference,
    );
  }
  initialize() {
    const overlaySession = session.fromPartition('screenstash-capture');
    overlaySession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    overlaySession.setPermissionCheckHandler(() => false);
    overlaySession.webRequest.onBeforeRequest((details, callback) => {
      const allowed =
        details.url.startsWith('screenstash://renderer/') ||
        (Boolean(this.developmentUrl) &&
          trustedRendererUrl(details.url, this.developmentUrl));
      callback({ cancel: !allowed });
    });
    overlaySession.protocol.handle('screenstash', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/frame/')) {
          if (
            !this.active ||
            url.href !== `screenstash://renderer/frame/${this.active.id}.png`
          )
            return new Response(null, { status: 404 });
          return new Response(new Uint8Array(this.active.frame.png), {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'no-store',
            },
          });
        }
        return await net.fetch(
          fileResponseUrl(resolveRendererAsset(this.assets, request.url)),
        );
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    overlaySession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            `default-src 'self'; script-src 'self'${this.developmentUrl ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' screenstash:; connect-src 'self'${this.developmentUrl ? ' ws://localhost:5173' : ''}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
          ],
        },
      }),
    );
    const trusted = (event: IpcMainInvokeEvent) => {
      const active = this.active;
      if (
        !active ||
        event.sender !== active.window.webContents ||
        event.senderFrame !== active.window.webContents.mainFrame ||
        !trustedRendererUrl(event.senderFrame.url, this.developmentUrl)
      )
        throw new Error('Selection request is not allowed');
      return active;
    };
    ipcMain.handle(captureChannels.regionContext, (event) => {
      const active = trusted(event);
      return {
        id: active.id,
        width: active.display.bounds.width,
        height: active.display.bounds.height,
        imageUrl: `screenstash://renderer/frame/${active.id}.png`,
      };
    });
    ipcMain.handle(captureChannels.regionSelect, (event, value) => {
      const active = trusted(event),
        parsed = regionSelectionSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== active.id)
        throw new Error('Selection request is not allowed');
      if (!parsed.data.rectangle) {
        active.settle(null);
        return;
      }
      const [width, height] = active.window.getContentSize();
      if (
        width !== active.display.bounds.width ||
        height !== active.display.bounds.height
      )
        throw new Error(
          'The selector is still sizing to this display. Please try again.',
        );
      try {
        active.settle(
          physicalRectangle(
            parsed.data.rectangle,
            active.display.bounds,
            active.frame,
          ),
        );
      } catch {
        throw new Error(
          'Select an area inside this display, at least two pixels wide and high.',
        );
      }
    });
    screen.on('display-removed', () => this.cancelChangedDisplay());
    screen.on('display-metrics-changed', () => this.cancelChangedDisplay());
    powerMonitor.on('lock-screen', () => {
      this.locked = true;
      this.error = 'SCREEN_LOCKED';
      this.active?.settle(null);
      this.changed();
    });
    powerMonitor.on('unlock-screen', () => {
      this.locked = false;
    });
    this.shortcuts.initialize();
  }
  setPrintScreenEnabled(enabled: boolean) {
    this.shortcuts.configure(enabled);
    this.changed();
    return this.state();
  }
  dispose() {
    this.active?.settle(null);
    this.shortcuts.dispose();
  }
  state() {
    return captureStateSchema.parse({
      busy: this.busy,
      error: this.error,
      captures: this.repository.list(),
      recoveryWarnings: this.repository.warnings,
      localBytes: this.repository.localBytes,
      ...this.shortcuts.state(),
    });
  }
  changed() {
    const main = this.mainWindow();
    if (main && !main.isDestroyed())
      main.webContents.send(captureChannels.changed);
  }
  private sameDisplay(display: Display) {
    const current = screen
      .getAllDisplays()
      .find((value) => value.id === display.id);
    return (
      current &&
      JSON.stringify(current.bounds) === JSON.stringify(display.bounds) &&
      current.scaleFactor === display.scaleFactor &&
      current.rotation === display.rotation
    );
  }
  private cancelChangedDisplay() {
    if (this.active && !this.sameDisplay(this.active.display)) {
      this.error = 'DISPLAY_CHANGED';
      this.active.settle(null);
    }
  }
  async capture(mode: 'display' | 'region') {
    if (this.busy || this.blocked())
      return { status: 'failed' as const, code: 'CAPTURE_BUSY' as const };
    if (this.locked) {
      this.error = 'SCREEN_LOCKED';
      this.changed();
      return { status: 'failed' as const, code: 'SCREEN_LOCKED' as const };
    }
    this.busy = true;
    this.error = null;
    this.changed();
    const main = this.mainWindow(),
      visible = main?.isVisible(),
      minimized = main?.isMinimized();
    // Freeze account and target at the instant capture starts, before hiding UI.
    const identity: CaptureIdentity | null = this.repository.currentIdentity();
    const display = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    main?.hide();
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (this.locked) throw new CaptureError('SCREEN_LOCKED');
      if (!this.sameDisplay(display)) throw new CaptureError('DISPLAY_CHANGED');
      const frame = await captureDisplay(display),
        capturedAt = new Date().toISOString();
      if (this.locked) throw new CaptureError('SCREEN_LOCKED');
      if (!this.sameDisplay(display)) throw new CaptureError('DISPLAY_CHANGED');
      let png = frame.png;
      if (mode === 'region') {
        const rectangle = await this.selectRegion(display, frame);
        if (!rectangle)
          return this.error
            ? { status: 'failed' as const, code: this.error }
            : { status: 'cancelled' as const };
        if (!this.sameDisplay(display))
          throw new CaptureError('DISPLAY_CHANGED');
        png = frame.image.crop(rectangle).toPNG({ scaleFactor: 1 });
      }
      try {
        const capture = await this.repository.save(
          png,
          mode,
          capturedAt,
          identity,
        );
        return { status: 'saved' as const, capture };
      } catch {
        throw new CaptureError('SAVE_FAILED');
      }
    } catch (error) {
      this.error =
        error instanceof CaptureError ? error.code : 'SOURCE_UNAVAILABLE';
      return { status: 'failed' as const, code: this.error };
    } finally {
      this.busy = false;
      if (visible && main && !main.isDestroyed()) {
        main.show();
        if (minimized) main.minimize();
      }
      this.changed();
    }
  }
  private selectRegion(
    display: Display,
    frame: Frame,
  ): Promise<ReturnType<typeof physicalRectangle> | null> {
    return new Promise((resolve, reject) => {
      const overlay = new BrowserWindow({
        ...display.bounds,
        // Frameless bounds alone are constrained to Windows' work area, which
        // would stretch the frozen frame and shift crops near the taskbar.
        fullscreen: true,
        thickFrame: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        backgroundColor: '#101615',
        webPreferences: {
          partition: 'screenstash-capture',
          preload: path.join(__dirname, 'region-preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      overlay.setMenu(null);
      const timer = setTimeout(() => settle(null), 120000);
      const settle = (
        rectangle: ReturnType<typeof physicalRectangle> | null,
      ) => {
        if (this.active?.window !== overlay) return;
        this.active = undefined;
        clearTimeout(timer);
        if (!overlay.isDestroyed()) overlay.destroy();
        resolve(rectangle);
      };
      this.active = {
        id: randomUUID(),
        display,
        frame,
        window: overlay,
        settle,
      };
      overlay.on('closed', () => settle(null));
      overlay.webContents.on('render-process-gone', () => {
        this.error = 'SELECTION_FAILED';
        settle(null);
      });
      overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      overlay.webContents.on('will-navigate', (event) =>
        event.preventDefault(),
      );
      overlay.webContents.on('will-redirect', (event) =>
        event.preventDefault(),
      );
      overlay.once('ready-to-show', () => {
        if (this.active?.window === overlay) {
          overlay.show();
          overlay.focus();
        }
      });
      const url = this.developmentUrl
        ? new URL('/region.html', this.developmentUrl).href
        : 'screenstash://renderer/region.html';
      void overlay.loadURL(url).catch(() => {
        this.error = 'SELECTION_FAILED';
        settle(null);
        reject(new CaptureError('SELECTION_FAILED'));
      });
    });
  }
}
