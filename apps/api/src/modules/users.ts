import { and, eq, isNull } from 'drizzle-orm';
import { users, devices, type Database } from '@screenstash/db';
import type { DeviceInput } from './types.js';
import { HttpError } from '../middleware/errors.js';

export async function resolveOwner(database: Database, clerkUserId: string) {
  return database.transaction(async (transaction) => {
    await transaction
      .insert(users)
      .values({ clerkUserId })
      .onConflictDoNothing({ target: users.clerkUserId });
    const [owner] = await transaction
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .for('update');
    if (!owner || owner.deletedAt)
      throw new HttpError(403, 'FORBIDDEN', 'This account is unavailable.');
    return owner;
  });
}
export async function registerDevice(
  database: Database,
  ownerId: string,
  input: DeviceInput,
) {
  return database.transaction(async (transaction) => {
    const [owner] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, ownerId), isNull(users.deletedAt)))
      .for('update');
    if (!owner)
      throw new HttpError(403, 'FORBIDDEN', 'This account is unavailable.');
    const [device] = await transaction
      .insert(devices)
      .values({ userId: ownerId, ...input })
      .onConflictDoUpdate({
        target: [devices.userId, devices.installationId],
        set: { name: input.name, lastSeenAt: new Date() },
      })
      .returning();
    if (!device)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Device registration could not complete.',
        true,
      );
    return {
      id: device.id,
      installationId: device.installationId,
      name: device.name,
      lastSeenAt: device.lastSeenAt.toISOString(),
    };
  });
}
