import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  devices,
  screenshots,
  uploadSessions,
  cleanupJobs,
  type Database,
} from '@screenstash/db';
import {
  screenshotDetailSchema,
  uploadSessionSchema,
  type UploadInput,
} from '@screenstash/shared';
import type { Environment } from '../config/environment.js';
import type { ObjectStore } from '../storage/r2.js';
import { boundedRead } from '../storage/r2.js';
import { processImage, verifyPng } from '../storage/images.js';
import { HttpError } from '../middleware/errors.js';
import { activeOwner, throttle, withProcessingAdmission } from './policy.js';
import { tagsForScreenshots } from './screenshot-tags.js';

type Session = typeof uploadSessions.$inferSelect;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const missing = () => new HttpError(404, 'NOT_FOUND', 'Upload not found.');
const deleted = () =>
  new HttpError(409, 'CAPTURE_DELETED', 'This capture was deleted.');
const putDuration = 300;
const expiryMargin = 60000;
export function screenshotDto(row: typeof screenshots.$inferSelect) {
  return screenshotDetailSchema.parse({
    id: row.id,
    captureId: row.captureId,
    title: row.title,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    capturedAt: row.capturedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    ocrStatus: row.ocrStatus,
    ocrText: row.ocrText,
    ocrTruncated: row.ocrTruncated,
    tags: [],
  });
}
export async function enqueueCleanup(
  transaction: Transaction,
  objectKey: string,
  userId: string,
  reason: string,
  notBefore = new Date(),
) {
  await transaction
    .insert(cleanupJobs)
    .values({ objectKey, userId, reason, notBefore, nextAttemptAt: notBefore })
    .onConflictDoNothing();
}
function immutable(session: Session) {
  return {
    captureId: session.captureId,
    deviceId: session.deviceId ?? undefined,
    title: session.title,
    capturedAt: session.capturedAt.toISOString(),
    mimeType: session.mimeType,
    sizeBytes: session.sizeBytes,
    width: session.width,
    height: session.height,
    sha256: session.sha256,
    ocrStatus: session.ocrStatus,
    ocrText: session.ocrText,
    ocrTruncated: session.ocrTruncated,
  };
}
function fingerprint(value: object) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(value)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest('hex');
}
export class UploadService {
  constructor(
    private database: Database,
    private store: ObjectStore,
    private environment: Environment,
  ) {}
  async get(ownerId: string, id: string) {
    const [session] = await this.database
      .select()
      .from(uploadSessions)
      .where(
        and(eq(uploadSessions.id, id), eq(uploadSessions.userId, ownerId)),
      );
    if (!session) throw missing();
    return session;
  }
  dto(session: Session) {
    return uploadSessionSchema.parse({
      id: session.id,
      screenshotId: session.screenshotId,
      status:
        session.status === 'pending' && session.expiresAt <= new Date()
          ? 'expired'
          : session.status,
      expiresAt: session.expiresAt.toISOString(),
    });
  }
  async authorize(ownerId: string, input: UploadInput) {
    await throttle(this.database, `upload:${ownerId}`, 30);
    const session = await this.database.transaction(async (transaction) => {
      await activeOwner(transaction, ownerId);
      const [existing] = await transaction
        .select()
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.userId, ownerId),
            eq(uploadSessions.captureId, input.captureId),
          ),
        )
        .for('update');
      if (existing) {
        if (existing.status === 'deleted') throw deleted();
        if (fingerprint(immutable(existing)) !== fingerprint(input))
          throw new HttpError(
            409,
            'CONFLICT',
            'This capture has different upload metadata.',
          );
        return existing;
      }
      const [tombstone] = await transaction
        .select({ id: screenshots.id })
        .from(screenshots)
        .where(
          and(
            eq(screenshots.userId, ownerId),
            eq(screenshots.captureId, input.captureId),
          ),
        );
      if (tombstone) throw deleted();
      if (input.deviceId) {
        const [device] = await transaction
          .select({ id: devices.id })
          .from(devices)
          .where(
            and(eq(devices.id, input.deviceId), eq(devices.userId, ownerId)),
          );
        if (!device) throw new HttpError(404, 'NOT_FOUND', 'Device not found.');
      }
      await this.quota(transaction, ownerId, input.sizeBytes);
      const screenshotId = randomUUID(),
        attemptId = randomUUID(),
        id = randomUUID();
      const now = Date.now();
      const [created] = await transaction
        .insert(uploadSessions)
        .values({
          ...input,
          capturedAt: new Date(input.capturedAt),
          userId: ownerId,
          id,
          screenshotId,
          attemptId,
          stagingKey: `staging/${ownerId}/${id}/${attemptId}.png`,
          finalKey: `originals/${ownerId}/${screenshotId}/${randomUUID()}.png`,
          expiresAt: new Date(now + 86400000),
          latestPutExpiresAt: new Date(now + putDuration * 1000),
        })
        .returning();
      if (!created) throw missing();
      return created;
    });
    if (session.status === 'finalized') return this.dto(session);
    // Existing captures obtain a fresh attempt, retiring every previous write authorization.
    return this.renew(ownerId, session.id);
  }
  private async quota(
    transaction: Transaction,
    ownerId: string,
    additional: number,
    exclude?: string,
  ) {
    const [stored] = await transaction
      .select({
        bytes: sql<number>`coalesce(sum(${screenshots.sizeBytes}),0)::bigint`,
      })
      .from(screenshots)
      .where(
        and(eq(screenshots.userId, ownerId), isNull(screenshots.deletedAt)),
      );
    const [pending] = await transaction
      .select({
        bytes: sql<number>`coalesce(sum(${uploadSessions.sizeBytes}),0)::bigint`,
        count: sql<number>`count(*)::integer`,
      })
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.userId, ownerId),
          eq(uploadSessions.status, 'pending'),
          sql`${uploadSessions.expiresAt} > now()`,
          exclude ? sql`${uploadSessions.id} <> ${exclude}` : undefined,
        ),
      );
    if (
      Number(stored?.bytes ?? 0) + Number(pending?.bytes ?? 0) + additional >
        this.environment.ACCOUNT_STORAGE_BYTES ||
      Number(pending?.count ?? 0) >= this.environment.ACCOUNT_PENDING_UPLOADS
    )
      throw new HttpError(
        409,
        'QUOTA_EXCEEDED',
        'Your upload allowance has been reached.',
      );
  }
  async renew(ownerId: string, id: string) {
    await throttle(this.database, `renew:${ownerId}`, 20);
    const session = await this.database.transaction(async (transaction) => {
      await activeOwner(transaction, ownerId);
      const [current] = await transaction
        .select()
        .from(uploadSessions)
        .where(
          and(eq(uploadSessions.id, id), eq(uploadSessions.userId, ownerId)),
        )
        .for('update');
      if (!current) throw missing();
      if (current.status === 'deleted') throw deleted();
      if (current.status === 'finalized') return current;
      if (current.leaseExpiresAt && current.leaseExpiresAt > new Date())
        throw new HttpError(
          409,
          'CONFLICT',
          'This upload is being verified.',
          true,
        );
      await this.quota(transaction, ownerId, current.sizeBytes, id);
      await enqueueCleanup(
        transaction,
        current.stagingKey,
        ownerId,
        'upload_renewed',
        new Date(current.latestPutExpiresAt.getTime() + expiryMargin),
      );
      const now = Date.now(),
        attemptId = randomUUID();
      const [updated] = await transaction
        .update(uploadSessions)
        .set({
          attemptId,
          stagingKey: `staging/${ownerId}/${id}/${attemptId}.png`,
          status: 'pending',
          expiresAt: new Date(now + 86400000),
          latestPutExpiresAt: new Date(now + putDuration * 1000),
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(eq(uploadSessions.id, id))
        .returning();
      if (!updated) throw missing();
      return updated;
    });
    if (session.status !== 'pending') return this.dto(session);
    const seconds = Math.max(
      1,
      Math.floor((session.latestPutExpiresAt.getTime() - Date.now()) / 1000),
    );
    const putUrl = await this.store.authorize(
      session.stagingKey,
      session.sizeBytes,
      seconds,
    );
    return uploadSessionSchema.parse({
      ...this.dto(session),
      putUrl,
      putExpiresAt: session.latestPutExpiresAt.toISOString(),
      requiredHeaders: { 'Content-Type': 'image/png' },
    });
  }
  async finalized(ownerId: string, session: Session) {
    const [image] = await this.database
      .select()
      .from(screenshots)
      .where(
        and(
          eq(screenshots.id, session.screenshotId),
          eq(screenshots.userId, ownerId),
          isNull(screenshots.deletedAt),
        ),
      );
    if (!image) throw deleted();
    return {
      ...screenshotDto(image),
      tags:
        (await tagsForScreenshots(this.database, ownerId, [image.id])).get(
          image.id,
        ) ?? [],
    };
  }
  async finalize(ownerId: string, id: string) {
    await throttle(this.database, `finalize:${ownerId}`, 30);
    const initial = await this.get(ownerId, id);
    if (initial.status === 'finalized') return this.finalized(ownerId, initial);
    return withProcessingAdmission(
      this.database,
      ownerId,
      this.environment.IMAGE_PROCESSING_GLOBAL_LIMIT,
      () =>
        processImage(async () => {
          const leaseToken = randomUUID();
          const session = await this.database.transaction(
            async (transaction) => {
              await activeOwner(transaction, ownerId);
              const [current] = await transaction
                .select()
                .from(uploadSessions)
                .where(
                  and(
                    eq(uploadSessions.id, id),
                    eq(uploadSessions.userId, ownerId),
                  ),
                )
                .for('update');
              if (!current) throw missing();
              if (current.status === 'deleted') throw deleted();
              if (current.status === 'finalized') return current;
              if (
                current.status !== 'pending' ||
                current.expiresAt <= new Date()
              )
                throw new HttpError(
                  409,
                  'UPLOAD_EXPIRED',
                  'Renew this upload before trying again.',
                );
              if (current.leaseExpiresAt && current.leaseExpiresAt > new Date())
                throw new HttpError(
                  409,
                  'CONFLICT',
                  'This upload is being verified.',
                  true,
                );
              const finalKey = `originals/${ownerId}/${current.screenshotId}/${randomUUID()}.png`;
              await enqueueCleanup(
                transaction,
                current.finalKey,
                ownerId,
                'retired_final',
                new Date(Date.now() + 300000),
              );
              // Register the possible orphan before writing, so an interrupted function remains recoverable.
              await enqueueCleanup(
                transaction,
                finalKey,
                ownerId,
                'incomplete_finalize',
                new Date(Date.now() + 300000),
              );
              const [claimed] = await transaction
                .update(uploadSessions)
                .set({
                  leaseToken,
                  leaseExpiresAt: new Date(Date.now() + 120000),
                  finalKey,
                })
                .where(eq(uploadSessions.id, id))
                .returning();
              if (!claimed) throw missing();
              return claimed;
            },
          );
          if (session.status === 'finalized')
            return this.finalized(ownerId, session);
          try {
            const { bytes, type } = await boundedRead(
              this.store,
              session.stagingKey,
              session.sizeBytes,
            );
            if (type !== 'image/png')
              throw new HttpError(
                400,
                'UPLOAD_INVALID',
                'The uploaded image has the wrong content type.',
              );
            await verifyPng(bytes, session);
            // Write exactly the verified buffer, never copy mutable staging content after verification.
            await this.store.write(session.finalKey, bytes, 'image/png');
            const image = await this.database.transaction(
              async (transaction) => {
                await activeOwner(transaction, ownerId);
                const [current] = await transaction
                  .select()
                  .from(uploadSessions)
                  .where(eq(uploadSessions.id, id))
                  .for('update');
                if (
                  !current ||
                  current.status !== 'pending' ||
                  current.leaseToken !== leaseToken ||
                  current.attemptId !== session.attemptId ||
                  !current.leaseExpiresAt ||
                  current.leaseExpiresAt <= new Date()
                )
                  throw new HttpError(
                    409,
                    'CONFLICT',
                    'Upload verification was interrupted. Try again.',
                    true,
                  );
                const [inserted] = await transaction
                  .insert(screenshots)
                  .values({
                    ...immutable(session),
                    capturedAt: session.capturedAt,
                    id: session.screenshotId,
                    userId: ownerId,
                    objectKey: session.finalKey,
                    mimeType: 'image/png',
                    searchVector: sql`setweight(to_tsvector('simple', ${session.title}), 'A') || setweight(to_tsvector('simple', ${session.ocrText}), 'C')`,
                  })
                  .returning();
                await transaction
                  .update(uploadSessions)
                  .set({
                    status: 'finalized',
                    finalizedAt: new Date(),
                    leaseToken: null,
                    leaseExpiresAt: null,
                  })
                  .where(eq(uploadSessions.id, id));
                await transaction
                  .update(cleanupJobs)
                  .set({ completedAt: new Date() })
                  .where(
                    and(
                      eq(cleanupJobs.objectKey, session.finalKey),
                      isNull(cleanupJobs.completedAt),
                    ),
                  );
                await enqueueCleanup(
                  transaction,
                  session.stagingKey,
                  ownerId,
                  'upload_finalized',
                  new Date(session.latestPutExpiresAt.getTime() + expiryMargin),
                );
                if (!inserted) throw missing();
                return inserted;
              },
            );
            return screenshotDto(image);
          } catch (error) {
            await this.database
              .update(uploadSessions)
              .set({
                leaseToken: null,
                leaseExpiresAt: null,
                ...(error instanceof HttpError &&
                error.code === 'UPLOAD_INVALID'
                  ? { status: 'rejected' as const }
                  : {}),
              })
              .where(
                and(
                  eq(uploadSessions.id, id),
                  eq(uploadSessions.leaseToken, leaseToken),
                  eq(uploadSessions.status, 'pending'),
                ),
              );
            throw error;
          }
        }),
    );
  }
}
