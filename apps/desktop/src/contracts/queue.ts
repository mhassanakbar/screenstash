import { z } from 'zod';

export const desktopSettingsSchema = z.strictObject({
  autoUpload: z.boolean(),
  paused: z.boolean(),
  startup: z.boolean(),
});
export const defaultDesktopSettings = Object.freeze({
  autoUpload: true,
  paused: false,
  startup: false,
});
export const desktopSettingsPatchSchema = desktopSettingsSchema.partial();
export type DesktopSettings = z.infer<typeof desktopSettingsSchema>;
export type DesktopSettingsPatch = z.infer<typeof desktopSettingsPatchSchema>;
export const queueChannels = {
  settings: 'screenstash:settings',
  updateSettings: 'screenstash:settings-update',
  settingsChanged: 'screenstash:settings-changed',
  retryCapture: 'screenstash:capture-retry',
  uploadNow: 'screenstash:capture-upload-now',
} as const;
export interface QueueBridge {
  settings(): Promise<DesktopSettings>;
  updateSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
  retryCapture(id: string): Promise<void>;
  uploadNow(id: string): Promise<void>;
  onSettingsChanged(listener: () => void): () => void;
}
