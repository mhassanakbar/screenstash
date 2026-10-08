import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  uploadInputSchema,
  screenshotQuerySchema,
  screenshotPatchSchema,
  limits,
} from '@screenstash/shared';

export function uploadFixture() {
  return {
    captureId: randomUUID(),
    title: 'Capture',
    capturedAt: '2026-10-08T00:00:00Z',
    mimeType: 'image/png',
    sizeBytes: 100,
    width: 100,
    height: 100,
    sha256: 'a'.repeat(64),
    ocrStatus: 'complete',
    ocrText: 'Settings',
    ocrTruncated: false,
  };
}
describe('public API contracts', () => {
  it('rejects client ownership claims', () => {
    expect(
      uploadInputSchema.safeParse({ ...uploadFixture(), userId: randomUUID() })
        .success,
    ).toBe(false);
  });
  it('rejects oversized bytes, excessive pixels and non-PNG input', () => {
    for (const patch of [
      { sizeBytes: limits.uploadBytes + 1 },
      { width: 10000, height: 10000 },
      { mimeType: 'image/svg+xml' },
    ]) {
      expect(
        uploadInputSchema.safeParse({ ...uploadFixture(), ...patch }).success,
      ).toBe(false);
    }
  });
  it('requires empty text for failed OCR', () => {
    expect(
      uploadInputSchema.safeParse({ ...uploadFixture(), ocrStatus: 'failed' })
        .success,
    ).toBe(false);
    expect(
      uploadInputSchema.safeParse({
        ...uploadFixture(),
        ocrStatus: 'failed',
        ocrText: '',
      }).success,
    ).toBe(true);
  });
  it('validates dates, page sizes, and tag uniqueness', () => {
    expect(screenshotQuerySchema.parse({ limit: '25' }).limit).toBe(25);
    expect(screenshotQuerySchema.safeParse({ limit: true }).success).toBe(
      false,
    );
    expect(
      screenshotQuerySchema.safeParse({
        from: '2026-10-08T00:00:00Z',
        to: '2026-10-07T00:00:00Z',
      }).success,
    ).toBe(false);
    const tag = randomUUID();
    expect(
      screenshotPatchSchema.safeParse({ tagIds: [tag, tag] }).success,
    ).toBe(false);
    expect(screenshotPatchSchema.safeParse({}).success).toBe(false);
  });
});
