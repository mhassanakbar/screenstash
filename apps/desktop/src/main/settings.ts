import Store from 'electron-store';
import { app } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  defaultDesktopSettings,
  desktopSettingsPatchSchema,
  desktopSettingsSchema,
  type DesktopSettings,
} from '../contracts/queue';

export interface SettingsPersistence {
  get(key: 'settings'): unknown;
  set(key: 'settings', value: DesktopSettings): void;
}

export function configureWindowsStartup(enabled: boolean) {
  if (process.platform !== 'win32' || !app.isPackaged) {
    if (enabled) throw new Error('Startup requires the installed Windows app.');
    return;
  }
  const executable = path.basename(process.execPath);
  const installedDirectory = path.resolve(path.dirname(process.execPath), '..');
  const updater = path.join(installedDirectory, 'Update.exe');
  if (
    !existsSync(updater) ||
    !/^app-[^/\\]+$/.test(path.basename(path.dirname(process.execPath)))
  ) {
    if (enabled) throw new Error('Startup requires the installed Windows app.');
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: updater,
    args: [
      '--processStart',
      executable,
      '--process-start-args',
      '--background',
    ],
  });
}

export class DesktopSettingsStore {
  private readonly persistence: SettingsPersistence;
  private readonly applyStartup: (enabled: boolean) => void;

  constructor(
    options: {
      persistence?: SettingsPersistence;
      applyStartup?: (enabled: boolean) => void;
    } = {},
  ) {
    this.persistence =
      options.persistence ?? new Store({ name: 'desktop-settings' });
    this.applyStartup = options.applyStartup ?? configureWindowsStartup;
  }

  get(): DesktopSettings {
    const parsed = desktopSettingsSchema.safeParse(
      this.persistence.get('settings'),
    );
    return parsed.success ? { ...parsed.data } : { ...defaultDesktopSettings };
  }

  restoreStartup(): DesktopSettings {
    if (this.get().startup) {
      try {
        this.applyStartup(true);
      } catch {
        return this.update({ startup: false });
      }
    }
    return this.get();
  }

  update(value: unknown): DesktopSettings {
    const patch = desktopSettingsPatchSchema.parse(value);
    const previous = this.get();
    const next = desktopSettingsSchema.parse({ ...previous, ...patch });
    if (next.startup !== previous.startup) this.applyStartup(next.startup);
    try {
      this.persistence.set('settings', next);
    } catch (error) {
      if (next.startup !== previous.startup)
        this.applyStartup(previous.startup);
      throw error;
    }
    return { ...next };
  }
}
