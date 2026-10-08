import { and, eq, isNull, sql } from 'drizzle-orm';
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
