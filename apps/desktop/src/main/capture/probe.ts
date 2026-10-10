import { desktopCapturer, screen } from 'electron';
import { captureProbeSchema } from '../../contracts/bridge';

export async function probeDisplay() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const expectedWidth = Math.round(display.bounds.width * display.scaleFactor),
    expectedHeight = Math.round(display.bounds.height * display.scaleFactor);
  if (
    expectedWidth * expectedHeight > 40000000 ||
    Math.max(expectedWidth, expectedHeight) > 16384
  )
    throw new Error('This display exceeds the capture allocation limit.');
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: expectedWidth, height: expectedHeight },
    fetchWindowIcons: false,
  });
  const source = sources.find(
    (source) => source.display_id === String(display.id),
  );
  if (!source || source.thumbnail.isEmpty())
    throw new Error('The selected display could not be captured.');
  const actual = source.thumbnail.getSize();
  return captureProbeSchema.parse({
    displayId: display.id,
    displayWidth: display.bounds.width,
    displayHeight: display.bounds.height,
    scaleFactor: display.scaleFactor,
    expectedWidth,
    expectedHeight,
    actualWidth: actual.width,
    actualHeight: actual.height,
    nativeResolution:
      actual.width === expectedWidth && actual.height === expectedHeight,
  });
}
