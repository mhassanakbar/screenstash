import { randomUUID } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  cleanupJobs,
  uploadSessions,
  screenshots,
  screenshotShares,
  rateLimits,
  type Database,
} from '@screenstash/db';
import type { ObjectStore } from '../storage/r2.js';
import { enqueueCleanup } from './uploads.js';

export async function runMaintenance(
  database: Database,
  store: ObjectStore,
  batch = 20,
) {
  const deadline = Date.now() + 45000;
  await database.transaction(async (transaction) => {
    const expired = await transaction
      .select()
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.status, 'pending'),
          sql`${uploadSessions.expiresAt} <= now()`,
          or(
            isNull(uploadSessions.leaseExpiresAt),
            sql`${uploadSessions.leaseExpiresAt} <= now()`,
          ),
        ),
      )
      .limit(batch)
      .for('update', { skipLocked: true });
    for (const session of expired) {
      await transaction
        .update(uploadSessions)
        .set({ status: 'expired', leaseToken: null, leaseExpiresAt: null })
        .where(eq(uploadSessions.id, session.id));
      await enqueueCleanup(
        transaction,
        session.stagingKey,
        session.userId,
        'upload_expired',
        new Date(session.latestPutExpiresAt.getTime() + 60000),
      );
      await enqueueCleanup(
        transaction,
        session.finalKey,
        session.userId,
        'upload_expired',
        new Date(Date.now() + 300000),
      );
    }
    await transaction
      .delete(rateLimits)
      .where(sql`${rateLimits.expiresAt} < now() - interval '1 day'`);
  });
  let completed = 0,
    failed = 0;
  for (let i = 0; i < batch && Date.now() < deadline; i++) {
    const leaseToken = randomUUID();
    const job = await database.transaction(async (transaction) => {
      const [next] = await transaction
        .select()
        .from(cleanupJobs)
        .where(
          and(
            isNull(cleanupJobs.completedAt),
            sql`${cleanupJobs.notBefore} <= now()`,
            sql`${cleanupJobs.nextAttemptAt} <= now()`,
            or(
              isNull(cleanupJobs.leaseExpiresAt),
              sql`${cleanupJobs.leaseExpiresAt} <= now()`,
            ),
          ),
        )
        .orderBy(cleanupJobs.nextAttemptAt)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!next) return;
      await transaction
        .update(cleanupJobs)
        .set({
          leaseToken,
          leaseExpiresAt: new Date(Date.now() + 120000),
          attempts: next.attempts + 1,
        })
        .where(eq(cleanupJobs.id, next.id));
      return next;
    });
    if (!job) break;
    try {
      const [original] = await database
        .select({ id: screenshots.id })
        .from(screenshots)
        .where(
          and(
            eq(screenshots.objectKey, job.objectKey),
            isNull(screenshots.deletedAt),
          ),
        )
        .limit(1);
      const [preview] = await database
        .select({ id: screenshotShares.id })
        .from(screenshotShares)
        .where(
          and(
            eq(screenshotShares.previewObjectKey, job.objectKey),
            isNull(screenshotShares.revokedAt),
          ),
        )
        .limit(1);
      const [writing] = await database
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.finalKey, job.objectKey),
            sql`${uploadSessions.leaseExpiresAt} > now()`,
          ),
        )
        .limit(1);
      if (writing || original || preview) {
        await database
          .update(cleanupJobs)
          .set({
            leaseToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(Date.now() + 180000),
          })
          .where(
            and(
              eq(cleanupJobs.id, job.id),
              eq(cleanupJobs.leaseToken, leaseToken),
            ),
          );
        continue;
      }
      await store.remove(job.objectKey);
      await database
        .update(cleanupJobs)
        .set({
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(cleanupJobs.id, job.id),
            eq(cleanupJobs.leaseToken, leaseToken),
          ),
        );
      completed++;
    } catch {
      failed++;
      await database
        .update(cleanupJobs)
        .set({
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(3600000, 1000 * 2 ** Math.min(job.attempts + 1, 12)),
          ),
        })
        .where(
          and(
            eq(cleanupJobs.id, job.id),
            eq(cleanupJobs.leaseToken, leaseToken),
          ),
        );
    }
  }
  return { completed, failed };
}
