import { z } from 'zod';
import { meSchema, deviceSchema } from '@screenstash/shared';

export const bridgeChannels = {
  configuration: 'screenstash:configuration',
  authenticate: 'screenstash:authenticate',
  invalidate: 'screenstash:invalidate-auth',
  tokenRequest: 'screenstash:token-request',
  tokenReply: 'screenstash:token-reply',
  probeCapture: 'screenstash:probe-capture',
  openVault: 'screenstash:open-vault',
} as const;
export const configurationSchema = z.object({
  authenticationConfigured: z.boolean(),
  packaged: z.boolean(),
  version: z.string(),
});
export const tokenReplySchema = z.strictObject({
  requestId: z.uuid(),
  token: z.string().min(1).max(16384).nullable(),
});
export const identitySchema = z.object({
  owner: meSchema,
  device: deviceSchema,
});
export const captureProbeSchema = z.object({
  displayId: z.number().int(),
  displayWidth: z.number().int().positive(),
  displayHeight: z.number().int().positive(),
  scaleFactor: z.number().positive(),
  expectedWidth: z.number().int().positive(),
  expectedHeight: z.number().int().positive(),
  actualWidth: z.number().int().positive(),
  actualHeight: z.number().int().positive(),
  nativeResolution: z.boolean(),
});
export interface DesktopBridge {
  readonly appName: 'ScreenStash';
  configuration(): Promise<z.infer<typeof configurationSchema>>;
  authenticate(): Promise<z.infer<typeof identitySchema>>;
  invalidateAuthentication(): Promise<void>;
  onTokenRequest(provider: () => Promise<string | null>): () => void;
  probeCapture(): Promise<z.infer<typeof captureProbeSchema>>;
  openVault(): Promise<void>;
}
