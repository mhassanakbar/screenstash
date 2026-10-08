import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Environment } from '../config/environment.js';
import { HttpError } from '../middleware/errors.js';

export interface ObjectStore {
  authorize(
    key: string,
    bytes: number,
    expiresSeconds: number,
  ): Promise<string>;
  read(
    key: string,
    signal?: AbortSignal,
  ): Promise<{ body: Readable; size: number; type: string }>;
  head(key: string): Promise<{ size: number; type: string }>;
  write(key: string, bytes: Buffer, type: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export function createObjectStore(
  environment: Environment,
): ObjectStore | undefined {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
    environment;
  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET
  )
    return;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
  const common = { Bucket: R2_BUCKET };
  const unavailable = () =>
    new HttpError(
      503,
      'DEPENDENCY_UNAVAILABLE',
      'Image storage is unavailable.',
      true,
    );
  return {
    async authorize(key, bytes, expiresSeconds) {
      try {
        return await getSignedUrl(
          client,
          new PutObjectCommand({
            ...common,
            Key: key,
            ContentType: 'image/png',
            ContentLength: bytes,
          }),
          {
            expiresIn: expiresSeconds,
            signableHeaders: new Set(['content-type']),
          },
        );
      } catch {
        throw unavailable();
      }
    },
    async read(key, signal) {
      try {
        const result = await client.send(
          new GetObjectCommand({ ...common, Key: key }),
          { abortSignal: signal ?? AbortSignal.timeout(30000) },
        );
        if (
          !(result.Body instanceof Readable) ||
          result.ContentLength === undefined
        )
          throw unavailable();
        return {
          body: result.Body,
          size: result.ContentLength,
          type: result.ContentType ?? 'application/octet-stream',
        };
      } catch (error) {
        if ((error as { name?: string }).name === 'NoSuchKey')
          throw new HttpError(
            409,
            'UPLOAD_NOT_READY',
            'The image has not finished uploading.',
            true,
          );
        throw unavailable();
      }
    },
    async head(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ ...common, Key: key }),
          { abortSignal: AbortSignal.timeout(10000) },
        );
        return {
          size: result.ContentLength ?? 0,
          type: result.ContentType ?? 'application/octet-stream',
        };
      } catch {
        throw unavailable();
      }
    },
    async write(key, bytes, type) {
      try {
        await client.send(
          new PutObjectCommand({
            ...common,
            Key: key,
            Body: bytes,
            ContentType: type,
            CacheControl: 'no-store',
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } catch {
        throw unavailable();
      }
    },
    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ ...common, Key: key }), {
          abortSignal: AbortSignal.timeout(10000),
        });
      } catch {
        throw unavailable();
      }
    },
  };
}
export async function boundedRead(
  store: ObjectStore,
  key: string,
  maximum: number,
) {
  const object = await store.read(key);
  if (object.size > maximum) {
    object.body.destroy();
    throw new HttpError(
      400,
      'UPLOAD_INVALID',
      'The uploaded image exceeds its declared size.',
    );
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of object.body) {
    const chunk = Buffer.from(value as Uint8Array);
    length += chunk.length;
    if (length > maximum) {
      object.body.destroy();
      throw new HttpError(
        400,
        'UPLOAD_INVALID',
        'The uploaded image exceeds its declared size.',
      );
    }
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), type: object.type };
}
