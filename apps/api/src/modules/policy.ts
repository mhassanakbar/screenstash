import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { users, rateLimits, type Database } from '@screenstash/db';
import { HttpError } from '../middleware/errors.js';

export async function activeOwner(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  ownerId: string,
) {
  const [owner] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerId), isNull(users.deletedAt)))
    .for('update');
  if (!owner)
    throw new HttpError(403, 'FORBIDDEN', 'This account is unavailable.');
}
export async function throttle(
  database: Database,
  key: string,
  maximum: number,
  seconds = 60,
) {
  const expiry = new Date(Date.now() + seconds * 1000);
  const [entry] = await database
    .insert(rateLimits)
    .values({ key, count: 1, expiresAt: expiry })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.expiresAt} <= now() THEN 1 ELSE ${rateLimits.count} + 1 END`,
        expiresAt: sql`CASE WHEN ${rateLimits.expiresAt} <= now() THEN ${expiry} ELSE ${rateLimits.expiresAt} END`,
      },
    })
    .returning();
  if (!entry || entry.count > maximum)
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Too many requests. Try again shortly.',
      true,
    );
}

// Expiring slots in PostgreSQL bound image work across all function instances.
export async function withProcessingAdmission<T>(
  database: Database,
  ownerId: string,
  maximum: number,
  operation: () => Promise<T>,
) {
  const key = `processing:${ownerId}:${randomUUID()}`;
  await database.transaction(async (transaction) => {
    await activeOwner(transaction, ownerId);
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('screenstash:image-processing'))`,
    );
    const [usage] = await transaction
      .select({
        global: sql<number>`count(*)::integer`,
        owner: sql<number>`count(*) FILTER (WHERE ${rateLimits.key} LIKE ${`processing:${ownerId}:%`})::integer`,
      })
      .from(rateLimits)
      .where(
        sql`${rateLimits.key} LIKE 'processing:%' AND ${rateLimits.expiresAt} > now()`,
      );
    if (Number(usage?.global ?? 0) >= maximum || Number(usage?.owner ?? 0) >= 2)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Image processing is busy. Try again shortly.',
        true,
      );
    // Longer than the explicit 120-second function duration; terminated workers recover by expiry.
    await transaction
      .insert(rateLimits)
      .values({ key, count: 1, expiresAt: new Date(Date.now() + 180000) });
  });
  try {
    return await operation();
  } finally {
    await database.delete(rateLimits).where(eq(rateLimits.key, key));
  }
}
