import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { isTerminalUploadError } from '../../apps/desktop/src/contracts/capture';
import {
  desktopSettingsPatchSchema,
  defaultDesktopSettings,
  type DesktopSettings,
} from '../../apps/desktop/src/contracts/queue';

const electron = vi.hoisted(() => ({
  app: { isPackaged: false, setLoginItemSettings: vi.fn() },
  setContextMenu: vi.fn(),
  setToolTip: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
}));
vi.mock('electron', () => ({
  app: electron.app,
  Tray: class {
    setContextMenu = electron.setContextMenu;
    setToolTip = electron.setToolTip;
    destroy = electron.destroy;
    on = electron.on;
  },
  Menu: { buildFromTemplate: (template: unknown) => template },
  nativeImage: { createFromBitmap: vi.fn(() => ({})) },
}));
vi.mock('electron-store', () => ({ default: class {} }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
import {
  DesktopSettingsStore,
  configureWindowsStartup,
} from '../../apps/desktop/src/main/settings';
import { createDesktopTray } from '../../apps/desktop/src/main/tray';

describe('Desktop settings and tray boundaries', () => {
  it('uses the same terminal upload policy for queue controls and synchronization', () => {
    for (const code of [
      'DELETED',
      'OWNER_DELETED',
      'INVALID_IMAGE',
      'INVALID_PAYLOAD',
    ])
      expect(isTerminalUploadError(code)).toBe(true);
    for (const code of [
      null,
      'SERVICE_UNAVAILABLE',
      'NETWORK_ERROR',
      'AUTH_REQUIRED',
    ])
      expect(isTerminalUploadError(code)).toBe(false);
  });
  it('registers the installed Squirrel updater without requiring a root app stub', () => {
    const originalExecutable = process.execPath;
    const originalPlatform = process.platform;
    const installedRoot = path.resolve('test-results', 'startup-layout');
    const updater = path.join(installedRoot, 'Update.exe');
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      Object.defineProperty(process, 'execPath', {
        value: path.join(installedRoot, 'app-1.0.0', 'ScreenStash.exe'),
      });
      electron.app.isPackaged = true;
      vi.mocked(existsSync).mockImplementation((target) => target === updater);
      configureWindowsStartup(true);
      expect(electron.app.setLoginItemSettings).toHaveBeenLastCalledWith({
        openAtLogin: true,
        path: updater,
        args: [
          '--processStart',
          'ScreenStash.exe',
          '--process-start-args',
          '--background',
        ],
      });
      Object.defineProperty(process, 'execPath', {
        value: path.join(installedRoot, 'unpacked', 'ScreenStash.exe'),
      });
      expect(() => configureWindowsStartup(true)).toThrow(
        'installed Windows app',
      );
    } finally {
      Object.defineProperty(process, 'execPath', { value: originalExecutable });
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      electron.app.isPackaged = false;
      vi.mocked(existsSync).mockReset();
    }
  });
  it('defaults to automatic upload, no pause, and opt-in startup', () => {
    const store = new DesktopSettingsStore({
      persistence: { get: () => undefined, set: vi.fn() },
    });
    expect(store.get()).toEqual(defaultDesktopSettings);
    expect(
      desktopSettingsPatchSchema.safeParse({ autoUpload: 'true' }).success,
    ).toBe(false);
    expect(
      desktopSettingsPatchSchema.safeParse({ arbitraryChannel: 'quit' })
        .success,
    ).toBe(false);
  });

  it('persists partial changes and returns detached snapshots', () => {
    let saved: unknown;
    const persistence = {
      get: () => saved,
      set: (_key: 'settings', value: unknown) => {
        saved = value;
      },
    };
    const applyStartup = vi.fn();
    const store = new DesktopSettingsStore({ persistence, applyStartup });
    store.update({ autoUpload: false });
    store.update({ paused: true });
    const restarted = new DesktopSettingsStore({ persistence, applyStartup });
    expect(restarted.get()).toEqual({
      autoUpload: false,
      paused: true,
      startup: false,
    });
    const snapshot = restarted.get();
    snapshot.autoUpload = true;
    expect(restarted.get().autoUpload).toBe(false);
    expect(applyStartup).not.toHaveBeenCalled();
  });

  it('does not persist rejected startup changes and rolls OS changes back on write failure', () => {
    const set = vi.fn();
    const store = new DesktopSettingsStore({
      persistence: { get: () => undefined, set },
      applyStartup: () => {
        throw new Error('Unsupported');
      },
    });
    expect(() => store.update({ startup: true })).toThrow('Unsupported');
    expect(set).not.toHaveBeenCalled();
    const applyStartup = vi.fn();
    const failingStore = new DesktopSettingsStore({
      persistence: {
        get: () => undefined,
        set: () => {
          throw new Error('Disk full');
        },
      },
      applyStartup,
    });
    expect(() => failingStore.update({ startup: true })).toThrow('Disk full');
    expect(applyStartup.mock.calls).toEqual([[true], [false]]);
    expect(() => store.update({ startup: true, unexpected: true })).toThrow();
  });

  it('routes only named tray actions and updates the pause action', async () => {
    const callbacks = {
      capture: vi.fn(),
      show: vi.fn(),
      openVault: vi.fn(),
      settings: vi.fn(),
      pause: vi.fn(),
      quit: vi.fn(),
      onError: vi.fn(),
    };
    const tray = createDesktopTray(callbacks, { ...defaultDesktopSettings });
    type MenuItem = { label?: string; click?: () => void };
    const menu = () => electron.setContextMenu.mock.lastCall?.[0] as MenuItem[];
    menu()
      .find((item) => item.label === 'Capture display')
      ?.click?.();
    menu()
      .find((item) => item.label === 'Pause processing')
      ?.click?.();
    await Promise.resolve();
    expect(callbacks.capture).toHaveBeenCalledWith('display');
    expect(callbacks.pause).toHaveBeenCalledWith(true);
    tray.update({ ...defaultDesktopSettings, paused: true });
    expect(menu().some((item) => item.label === 'Resume processing')).toBe(
      true,
    );
    callbacks.openVault.mockRejectedValueOnce(new Error('Offline'));
    menu()
      .find((item) => item.label === 'Open web vault')
      ?.click?.();
    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalledOnce());
    tray.destroy();
    expect(electron.destroy).toHaveBeenCalled();
  });

  it('disables an unsupported restored startup preference without preventing launch', () => {
    let saved: DesktopSettings = { ...defaultDesktopSettings, startup: true };
    const applyStartup = vi.fn((enabled: boolean) => {
      if (enabled) throw new Error('Not installed');
    });
    const store = new DesktopSettingsStore({
      persistence: {
        get: () => saved,
        set: (_key, value) => {
          saved = value;
        },
      },
      applyStartup,
    });
    expect(store.restoreStartup().startup).toBe(false);
    expect(saved.startup).toBe(false);
    expect(applyStartup.mock.calls).toEqual([[true], [false]]);
  });
});
