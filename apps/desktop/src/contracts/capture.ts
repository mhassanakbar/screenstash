import { z } from 'zod';
import { identitySchema } from './bridge';

export const captureModeSchema = z.enum(['display', 'region']);
export const rectangleSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
const captureRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  capturedAt: z.iso.datetime(),
  mode: z.enum(['display', 'region', 'recovered']),
  title: z.string().min(1).max(200),
  png: z.string(),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  identity: identitySchema.nullable(),
  ocrStatus: z.literal('pending'),
  uploadStatus: z.literal('pending'),
  uploadEligible: z.boolean(),
});
export const localCaptureSchema = captureRecordSchema.refine(
  (value) =>
    value.png === `${value.id}.png` && value.width * value.height <= 40000000,
  'Invalid local capture',
);
export type LocalCapture = z.infer<typeof localCaptureSchema>;
export type CaptureIdentity = z.infer<typeof identitySchema>;
// Strip internal manifest fields when projecting a record for the renderer.
export const captureSummarySchema = captureRecordSchema
  .omit({ schemaVersion: true, png: true, sha256: true, identity: true })
  .extend({ assigned: z.boolean() })
  .strip();
export type CaptureSummary = z.infer<typeof captureSummarySchema>;
export const captureCodeSchema = z.enum([
  'CAPTURE_BUSY',
  'DISPLAY_CHANGED',
  'SCREEN_LOCKED',
  'SOURCE_UNAVAILABLE',
  'RESOLUTION_UNSUPPORTED',
  'CAPTURE_TOO_LARGE',
  'SAVE_FAILED',
  'SELECTION_FAILED',
]);
export type CaptureCode = z.infer<typeof captureCodeSchema>;
export const captureOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), capture: captureSummarySchema }),
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('failed'), code: captureCodeSchema }),
]);
export const captureStateSchema = z.object({
  busy: z.boolean(),
  error: captureCodeSchema.nullable(),
  captures: z.array(captureSummarySchema),
  recoveryWarnings: z.number().int().nonnegative(),
  localBytes: z.number().int().nonnegative(),
  printScreen: z.object({ supported: z.boolean(), enabled: z.boolean() }),
  shortcuts: z.array(
    z.object({
      mode: captureModeSchema,
      accelerator: z.string(),
      registered: z.boolean(),
    }),
  ),
});
export const regionContextSchema = z.object({
  id: z.uuid(),
  width: z.number().positive(),
  height: z.number().positive(),
  imageUrl: z.string().url(),
});
export const regionSelectionSchema = z.strictObject({
  id: z.uuid(),
  rectangle: rectangleSchema.nullable(),
});
export const captureChannels = {
  start: 'screenstash:capture-start',
  state: 'screenstash:capture-state',
  changed: 'screenstash:captures-changed',
  reveal: 'screenstash:capture-reveal',
  keyboardSettings: 'screenstash:keyboard-settings',
  printScreen: 'screenstash:print-screen',
  regionContext: 'screenstash:region-context',
  regionSelect: 'screenstash:region-select',
} as const;
export interface CaptureBridge {
  capture(
    mode: z.infer<typeof captureModeSchema>,
  ): Promise<z.infer<typeof captureOutcomeSchema>>;
  captureState(): Promise<z.infer<typeof captureStateSchema>>;
  revealCapture(id: string): Promise<void>;
  openKeyboardSettings(): Promise<void>;
  setPrintScreenEnabled(
    enabled: boolean,
  ): Promise<z.infer<typeof captureStateSchema>>;
  onCapturesChanged(listener: () => void): () => void;
}
export interface RegionBridge {
  context(): Promise<z.infer<typeof regionContextSchema>>;
  select(value: z.infer<typeof regionSelectionSchema>): Promise<void>;
}
