import { Router, raw } from 'express';
import { verifyWebhook } from '@clerk/express/webhooks';
import { and, eq, isNull } from 'drizzle-orm';
import {
  users,
  screenshots,
  screenshotShares,
  screenshotTags,
  uploadSessions,
  cleanupJobs,
  webhookEvents,
  tags,
  devices,
  type Database,
} from '@screenstash/db';
import type { Environment } from '../config/environment.js';
import { HttpError } from '../middleware/errors.js';

export async function deleteAccount(
  database: Database,
  eventId: string,
  clerkUserId: string,
) {
  await database.transaction(async (transaction) => {
    const recorded = await transaction
      .insert(webhookEvents)
      .values({ eventId, eventType: 'user.deleted' })
      .onConflictDoNothing()
      .returning();
    if (recorded.length === 0) return;
    // Provision a tombstone even if deletion arrives before the first application request.
    await transaction
      .insert(users)
      .values({ clerkUserId, deletedAt: new Date() })
      .onConflictDoNothing({ target: users.clerkUserId });
    const [owner] = await transaction
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .for('update');
    if (!owner)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Account deletion could not complete.',
        true,
      );
    const now = new Date();
    await transaction
      .update(users)
      .set({ deletedAt: owner.deletedAt ?? now })
      .where(eq(users.id, owner.id));
    const images = await transaction
      .select({ key: screenshots.objectKey })
      .from(screenshots)
      .where(eq(screenshots.userId, owner.id));
    const previews = await transaction
      .select({ key: screenshotShares.previewObjectKey })
      .from(screenshotShares)
      .where(eq(screenshotShares.userId, owner.id));
    const staging = await transaction
      .select({
        key: uploadSessions.stagingKey,
        expires: uploadSessions.latestPutExpiresAt,
        final: uploadSessions.finalKey,
      })
      .from(uploadSessions)
      .where(eq(uploadSessions.userId, owner.id));
    const jobs = [
      ...images
        .filter((image) => image.key)
        .map((image) => ({ objectKey: image.key!, notBefore: now })),
      ...previews.map((preview) => ({
        objectKey: preview.key,
        notBefore: now,
      })),
      ...staging.flatMap((session) => [
        {
          objectKey: session.key,
          notBefore: new Date(
            Math.max(now.getTime(), session.expires.getTime() + 60000),
          ),
        },
        {
          objectKey: session.final,
          notBefore: new Date(now.getTime() + 5 * 60000),
        },
      ]),
    ];
    for (const job of jobs)
      await transaction
        .insert(cleanupJobs)
        .values({
          ...job,
          userId: owner.id,
          reason: 'account_deleted',
          nextAttemptAt: job.notBefore,
        })
        .onConflictDoNothing();
    await transaction
      .update(screenshots)
      .set({ deletedAt: now, title: null, ocrText: null, searchVector: null })
      .where(
        and(eq(screenshots.userId, owner.id), isNull(screenshots.deletedAt)),
      );
    await transaction
      .update(screenshotShares)
      .set({ revokedAt: now })
      .where(
        and(
          eq(screenshotShares.userId, owner.id),
          isNull(screenshotShares.revokedAt),
        ),
      );
    await transaction
      .delete(screenshotTags)
      .where(eq(screenshotTags.userId, owner.id));
    await transaction.delete(tags).where(eq(tags.userId, owner.id));
    await transaction
      .update(devices)
      .set({ name: 'Deleted device' })
      .where(eq(devices.userId, owner.id));
    // Deleted sessions no longer represent a finalized upload.
    await transaction
      .update(uploadSessions)
      .set({
        status: 'deleted',
        finalizedAt: null,
        title: 'Deleted capture',
        ocrText: '',
        ocrStatus: 'failed',
      })
      .where(eq(uploadSessions.userId, owner.id));
  });
}
export function clerkWebhook(environment: Environment, database?: Database) {
  const router = Router();
  router.post(
    '/api/webhooks/clerk',
    raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
      if (!environment.CLERK_WEBHOOK_SIGNING_SECRET || !database)
        throw new HttpError(
          503,
          'DEPENDENCY_UNAVAILABLE',
          'Webhook processing is unavailable.',
          true,
        );
      let event;
      try {
        event = await verifyWebhook(req, {
          signingSecret: environment.CLERK_WEBHOOK_SIGNING_SECRET,
        });
      } catch {
        throw new HttpError(
          400,
          'INVALID_INPUT',
          'The webhook signature is invalid.',
        );
      }
      if (event.type === 'user.deleted') {
        const eventId = req.get('svix-id'),
          clerkUserId = event.data.id;
        if (
          !eventId ||
          eventId.length > 256 ||
          !clerkUserId ||
          clerkUserId.length > 256
        )
          throw new HttpError(
            400,
            'INVALID_INPUT',
            'The webhook event is invalid.',
          );
        await deleteAccount(database, eventId, clerkUserId);
      }
      res.sendStatus(200);
    },
  );
  return router;
}
