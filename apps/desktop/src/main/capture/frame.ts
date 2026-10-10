import { desktopCapturer, nativeImage, type Display } from 'electron';
import { pngDimensions } from './geometry';
import type { CaptureCode } from '../../contracts/capture';
export class CaptureError extends Error {
  constructor(readonly code: CaptureCode) {
    super(code);
  }
}
export async function captureDisplay(display: Display) {
  const width = Math.round(display.bounds.width * display.scaleFactor),
    height = Math.round(display.bounds.height * display.scaleFactor);
  if (width * height > 40000000 || Math.max(width, height) > 16384)
    throw new CaptureError('CAPTURE_TOO_LARGE');
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false,
  });
  const source = sources.find(
    (source) => source.display_id === String(display.id),
  );
  if (!source || source.thumbnail.isEmpty())
    throw new CaptureError('SOURCE_UNAVAILABLE');
  const png = source.thumbnail.toPNG({ scaleFactor: 1 });
  const actual = pngDimensions(png);
  if (actual.width !== width || actual.height !== height)
    throw new CaptureError('RESOLUTION_UNSUPPORTED');
  return { image: nativeImage.createFromBuffer(png), png, ...actual };
}
