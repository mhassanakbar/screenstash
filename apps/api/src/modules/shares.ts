import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { and, eq, isNull } from 'drizzle-orm';
import {
  screenshots,
  screenshotShares,
  users,
  cleanupJobs,
  type Database,
} from '@screenstash/db';
import {
  shareCreatedSchema,
  shareStatusSchema,
  publicShareSchema,
  shareTokenSchema,
} from '@screenstash/shared';
import type { Environment } from '../config/environment.js';
import { boundedRead, type ObjectStore } from '../storage/r2.js';
import { processImage } from '../storage/images.js';
import { HttpError } from '../middleware/errors.js';
import { activeOwner, throttle, withProcessingAdmission } from './policy.js';
import { enqueueCleanup } from './uploads.js';

const unavailable = () =>
  new HttpError(404, 'NOT_FOUND', 'This shared screenshot is unavailable.');
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export class ShareService {
  constructor(
    private database: Database,
    private store: ObjectStore,
    private environment: Environment,
  ) {}
  async status(ownerId: string, id: string) {
    const [image] = await this.database
      .select({ id: screenshots.id })
      .from(screenshots)
      .where(
        and(
          eq(screenshots.id, id),
          eq(screenshots.userId, ownerId),
          isNull(screenshots.deletedAt),
        ),
      );
    if (!image) throw new HttpError(404, 'NOT_FOUND', 'Screenshot not found.');
    const [share] = await this.database
      .select()
      .from(screenshotShares)
      .where(
        and(
          eq(screenshotShares.screenshotId, id),
          eq(screenshotShares.userId, ownerId),
          isNull(screenshotShares.revokedAt),
        ),
      );
    return shareStatusSchema.parse({
      active: !!share,
      publicTitle: share?.publicTitle ?? null,
      createdAt: share?.createdAt.toISOString() ?? null,
    });
  }
  async create(
    ownerId: string,
    id: string,
    publicTitle: string,
    replaceActive: boolean,
  ) {
    await throttle(this.database, `shares:${ownerId}`, 10);
    return withProcessingAdmission(
      this.database,
      ownerId,
      this.environment.IMAGE_PROCESSING_GLOBAL_LIMIT,
      () =>
        processImage(async () => {
          const shareId = randomUUID(),
            token = randomBytes(32).toString('base64url');
          const previewKey = `previews/${ownerId}/${id}/${shareId}.jpg`;
          const started = Date.now();
          const image = await this.database.transaction(async (transaction) => {
            await activeOwner(transaction, ownerId);
            const [original] = await transaction
              .select()
              .from(screenshots)
              .where(
                and(
                  eq(screenshots.id, id),
                  eq(screenshots.userId, ownerId),
                  isNull(screenshots.deletedAt),
                ),
              )
              .for('update');
            if (!original?.objectKey)
              throw new HttpError(404, 'NOT_FOUND', 'Screenshot not found.');
            const [existing] = await transaction
              .select({ id: screenshotShares.id })
              .from(screenshotShares)
              .where(
                and(
                  eq(screenshotShares.screenshotId, id),
                  isNull(screenshotShares.revokedAt),
                ),
              );
            if (existing && !replaceActive)
              throw new HttpError(
                409,
                'CONFLICT',
                'A public link is already active. Replace it to create a new link.',
              );
            await enqueueCleanup(
              transaction,
              previewKey,
              ownerId,
              'incomplete_share',
              new Date(started + 300000),
            );
            return original;
          });
          const { bytes, type } = await boundedRead(
            this.store,
            image.objectKey!,
            image.sizeBytes!,
          );
          if (
            type !== 'image/png' ||
            bytes.length !== image.sizeBytes ||
            hashBytes(bytes) !== image.sha256
          )
            throw new HttpError(
              503,
              'DEPENDENCY_UNAVAILABLE',
              'The original image could not be verified.',
              true,
            );
          let preview: Buffer;
          try {
            preview = await sharp(bytes, {
              limitInputPixels: 40000000,
              failOn: 'warning',
            })
              .resize(1200, 630, { fit: 'contain', background: '#f5f5f4' })
              .flatten({ background: '#f5f5f4' })
              .jpeg({ quality: 85 })
              .timeout({ seconds: 20 })
              .toBuffer();
          } catch {
            throw new HttpError(
              503,
              'DEPENDENCY_UNAVAILABLE',
              'The sharing preview could not be generated. Try again shortly.',
              true,
            );
          }
          await this.store.write(previewKey, preview, 'image/jpeg');
          const created = await this.database.transaction(
            async (transaction) => {
              await activeOwner(transaction, ownerId);
              const [current] = await transaction
                .select()
                .from(screenshots)
                .where(
                  and(
                    eq(screenshots.id, id),
                    eq(screenshots.userId, ownerId),
                    isNull(screenshots.deletedAt),
                  ),
                )
                .for('update');
              if (!current || current.objectKey !== image.objectKey)
                throw new HttpError(404, 'NOT_FOUND', 'Screenshot not found.');
              if (Date.now() - started > 120000)
                throw new HttpError(
                  503,
                  'DEPENDENCY_UNAVAILABLE',
                  'Sharing was interrupted. Try again shortly.',
                  true,
                );
              const [existing] = await transaction
                .select()
                .from(screenshotShares)
                .where(
                  and(
                    eq(screenshotShares.screenshotId, id),
                    isNull(screenshotShares.revokedAt),
                  ),
                );
              if (existing) {
                if (!replaceActive)
                  throw new HttpError(
                    409,
                    'CONFLICT',
                    'A public link is already active.',
                  );
                await transaction
                  .update(screenshotShares)
                  .set({ revokedAt: new Date() })
                  .where(eq(screenshotShares.id, existing.id));
                await enqueueCleanup(
                  transaction,
                  existing.previewObjectKey,
                  ownerId,
                  'share_replaced',
                );
              }
              const [share] = await transaction
                .insert(screenshotShares)
                .values({
                  id: shareId,
                  userId: ownerId,
                  screenshotId: id,
                  tokenHash: hash(token),
                  publicTitle,
                  previewObjectKey: previewKey,
                })
                .returning();
              await transaction
                .update(cleanupJobs)
                .set({ completedAt: new Date() })
                .where(
                  and(
                    eq(cleanupJobs.objectKey, previewKey),
                    isNull(cleanupJobs.completedAt),
                  ),
                );
              if (!share) throw unavailable();
              return share;
            },
          );
          return shareCreatedSchema.parse({
            url: new URL(`/s/${token}`, this.environment.PUBLIC_BASE_URL).href,
            publicTitle: created.publicTitle,
            createdAt: created.createdAt.toISOString(),
          });
        }),
    );
  }
  async revoke(ownerId: string, id: string) {
    await this.database.transaction(async (transaction) => {
      await activeOwner(transaction, ownerId);
      const [image] = await transaction
        .select({ id: screenshots.id })
        .from(screenshots)
        .where(
          and(
            eq(screenshots.id, id),
            eq(screenshots.userId, ownerId),
            isNull(screenshots.deletedAt),
          ),
        )
        .for('update');
      if (!image)
        throw new HttpError(404, 'NOT_FOUND', 'Screenshot not found.');
      const [share] = await transaction
        .select()
        .from(screenshotShares)
        .where(
          and(
            eq(screenshotShares.screenshotId, id),
            isNull(screenshotShares.revokedAt),
          ),
        );
      if (share) {
        await transaction
          .update(screenshotShares)
          .set({ revokedAt: new Date() })
          .where(eq(screenshotShares.id, share.id));
        await enqueueCleanup(
          transaction,
          share.previewObjectKey,
          ownerId,
          'share_revoked',
        );
      }
    });
  }
  async resolve(token: string) {
    if (!shareTokenSchema.safeParse(token).success) throw unavailable();
    const [result] = await this.database
      .select({ share: screenshotShares, image: screenshots })
      .from(screenshotShares)
      .innerJoin(
        screenshots,
        and(
          eq(screenshots.id, screenshotShares.screenshotId),
          eq(screenshots.userId, screenshotShares.userId),
        ),
      )
      .innerJoin(users, eq(users.id, screenshots.userId))
      .where(
        and(
          eq(screenshotShares.tokenHash, hash(token)),
          isNull(screenshotShares.revokedAt),
          isNull(screenshots.deletedAt),
          isNull(users.deletedAt),
        ),
      );
    if (!result?.image.objectKey) throw unavailable();
    return result;
  }
  async publicDetails(token: string) {
    const { share, image } = await this.resolve(token);
    const [original, preview] = await Promise.all([
      this.store.head(image.objectKey!),
      this.store.head(share.previewObjectKey),
    ]);
    if (
      original.size !== image.sizeBytes ||
      original.type !== 'image/png' ||
      preview.type !== 'image/jpeg' ||
      preview.size <= 0
    )
      throw unavailable();
    return publicShareSchema.parse({
      publicTitle: share.publicTitle,
      imageUrl: new URL(`/s/${token}/image`, this.environment.PUBLIC_BASE_URL)
        .href,
      previewUrl: new URL(
        `/s/${token}/preview.jpg`,
        this.environment.PUBLIC_BASE_URL,
      ).href,
      width: image.width,
      height: image.height,
      mimeType: 'image/png',
    });
  }
}
function hashBytes(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}
