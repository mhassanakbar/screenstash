import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import type { DesktopSettings } from '../contracts/queue';

export interface DesktopTrayCallbacks {
  capture(mode: 'display' | 'region'): void | Promise<unknown>;
  show(): void | Promise<unknown>;
  openVault(): void | Promise<unknown>;
  settings(): void | Promise<unknown>;
  pause(paused: boolean): void | Promise<unknown>;
  quit(): void;
  onError(): void;
}

export function createDesktopTray(
  callbacks: DesktopTrayCallbacks,
  initialSettings: DesktopSettings,
  icon?: NativeImage,
) {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      const offset = (row * 16 + column) * 4;
      const border = row === 2 || row === 13 || column === 2 || column === 13;
      const visible = row >= 2 && row <= 13 && column >= 2 && column <= 13;
      pixels[offset] = border ? 255 : 87;
      pixels[offset + 1] = border ? 255 : 120;
      pixels[offset + 2] = border ? 255 : 4;
      pixels[offset + 3] = visible ? 255 : 0;
    }
  }
  const fallback = nativeImage.createFromBitmap(pixels, {
    width: 16,
    height: 16,
  });
  const tray = new Tray(icon ?? fallback);
  const run = (operation: () => unknown) => {
    void Promise.resolve()
      .then(operation)
      .catch(() => callbacks.onError());
  };
  const update = (settings: DesktopSettings) => {
    tray.setToolTip(
      settings.paused ? 'ScreenStash - processing paused' : 'ScreenStash',
    );
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Capture display',
          click: () => run(() => callbacks.capture('display')),
        },
        {
          label: 'Select region',
          click: () => run(() => callbacks.capture('region')),
        },
        { type: 'separator' },
        { label: 'Show queue', click: () => run(callbacks.show) },
        { label: 'Open web vault', click: () => run(callbacks.openVault) },
        { label: 'Settings', click: () => run(callbacks.settings) },
        {
          label: settings.paused ? 'Resume processing' : 'Pause processing',
          click: () => run(() => callbacks.pause(!settings.paused)),
        },
        { type: 'separator' },
        { label: 'Quit ScreenStash', click: callbacks.quit },
      ]),
    );
  };
  tray.on('double-click', () => run(callbacks.show));
  update(initialSettings);
  return { update, destroy: () => tray.destroy() };
}
