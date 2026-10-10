import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { limits } from '@screenstash/shared';
import { HttpError } from '../middleware/errors.js';

sharp.cache(false);
sharp.concurrency(1);
let processing = 0;
export async function processImage<T>(operation: () => Promise<T>) {
  if (processing >= 1)
    throw new HttpError(
      503,
      'DEPENDENCY_UNAVAILABLE',
      'Image processing is busy. Try again shortly.',
      true,
    );
  processing++;
  try {
    return await operation();
  } finally {
    processing--;
  }
}
export async function verifyPng(
  bytes: Buffer,
  expected: {
    sizeBytes: number;
    sha256: string;
    width: number;
    height: number;
  },
) {
  if (
    bytes.length !== expected.sizeBytes ||
    createHash('sha256').update(bytes).digest('hex') !== expected.sha256 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new HttpError(
      400,
      'UPLOAD_INVALID',
      'The uploaded image does not match its capture.',
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: limits.imagePixels,
      failOn: 'warning',
      animated: true,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== 'png' ||
      metadata.width !== expected.width ||
      metadata.height !== expected.height ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error('Invalid dimensions or format');
    // Force bounded full decoding so a valid header cannot hide truncated/corrupt pixels.
    await image.timeout({ seconds: 20 }).stats();
  } catch (error) {
    if (error instanceof Error && /timeout/i.test(error.message))
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Image verification exceeded its processing time. Try again shortly.',
        true,
      );
    throw new HttpError(
      400,
      'UPLOAD_INVALID',
      'The uploaded PNG could not be verified.',
    );
  }
}
