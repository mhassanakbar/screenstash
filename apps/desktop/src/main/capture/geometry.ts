import { rectangleSchema } from '../../contracts/capture';

export function physicalRectangle(
  value: unknown,
  display: { width: number; height: number },
  frame: { width: number; height: number },
) {
  const rectangle = rectangleSchema.parse(value);
  if (
    rectangle.x < -1 ||
    rectangle.y < -1 ||
    rectangle.x + rectangle.width > display.width + 1 ||
    rectangle.y + rectangle.height > display.height + 1
  )
    throw new Error('Selection outside display');
  const x = Math.max(
    0,
    Math.floor((rectangle.x * frame.width) / display.width),
  );
  const y = Math.max(
    0,
    Math.floor((rectangle.y * frame.height) / display.height),
  );
  const right = Math.min(
    frame.width,
    Math.ceil(((rectangle.x + rectangle.width) * frame.width) / display.width),
  );
  const bottom = Math.min(
    frame.height,
    Math.ceil(
      ((rectangle.y + rectangle.height) * frame.height) / display.height,
    ),
  );
  if (right <= x || bottom <= y || rectangle.width < 2 || rectangle.height < 2)
    throw new Error('Selection is too small');
  return { x, y, width: right - x, height: bottom - y };
}
export function pngDimensions(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('Invalid PNG');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width * height > 40000000 ||
    Math.max(width, height) > 16384
  )
    throw new Error('Invalid PNG dimensions');
  return { width, height };
}
