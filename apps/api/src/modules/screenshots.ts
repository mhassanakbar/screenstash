import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, lt, or, sql, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  screenshots,
  screenshotShares,
  screenshotTags,
  uploadSessions,
  users,
  tags,
  type Database,
} from '@screenstash/db';
import {
  idSchema,
  screenshotSchema,
  timestampSchema,
  screenshotQuerySchema,
  type ScreenshotPatch,
} from '@screenstash/shared';
import { HttpError } from '../middleware/errors.js';
import { activeOwner, throttle } from './policy.js';
import { enqueueCleanup, screenshotDto } from './uploads.js';
import { tagsForScreenshots } from './screenshot-tags.js';

const cursorSchema = z.strictObject({
  owner: idSchema,
  capturedAt: timestampSchema,
  id: idSchema,
  filter: z.string().length(64),
  rank: z.number().finite().nonnegative().default(0),
});
const missing = () => new HttpError(404, 'NOT_FOUND', 'Screenshot not found.');
export async function getScreenshot(
  database: Database,
  ownerId: string,
  id: string,
) {
  const [result] = await database
    .select({ image: screenshots })
    .from(screenshots)
    .innerJoin(users, eq(users.id, screenshots.userId))
    .where(
      and(
        eq(screenshots.userId, ownerId),
        eq(screenshots.id, id),
        isNull(screenshots.deletedAt),
        isNull(users.deletedAt),
      ),
    );
  if (!result) throw missing();
  return {
    ...screenshotDto(result.image),
    tags: (await tagsForScreenshots(database, ownerId, [id])).get(id) ?? [],
  };
}
export async function listScreenshots(
  database: Database,
  ownerId: string,
  limit: number,
  cursor?: string,
  filters: Partial<z.output<typeof screenshotQuerySchema>> = {},
) {
  const q = filters.q?.trim() ?? '';
  const tagIds = [...(filters.tagId ?? [])].sort();
  const filterHash = createHash('sha256')
    .update(
      JSON.stringify({
        q,
        tagIds,
        from: filters.from ?? null,
        to: filters.to ?? null,
      }),
    )
    .digest('hex');
  const rank = q
    ? sql<number>`ts_rank_cd(${screenshots.searchVector}, websearch_to_tsquery('simple', ${q}))::double precision`
    : sql<number>`0::double precision`;
  let after: z.infer<typeof cursorSchema> | undefined;
  if (cursor) {
    try {
      after = cursorSchema.parse(
        JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
      );
    } catch {
      throw new HttpError(
        400,
        'INVALID_INPUT',
        'The gallery cursor is invalid.',
      );
    }
    if (after.owner !== ownerId || after.filter !== filterHash)
      throw new HttpError(
        400,
        'INVALID_INPUT',
        'The gallery cursor belongs to different filters.',
      );
  }
  const rows = await database
    .select({ image: screenshots, rank })
    .from(screenshots)
    .innerJoin(users, eq(users.id, screenshots.userId))
    .where(
      and(
        eq(screenshots.userId, ownerId),
        isNull(screenshots.deletedAt),
        isNull(users.deletedAt),
        q
          ? sql`${screenshots.searchVector} @@ websearch_to_tsquery('simple', ${q}) AND numnode(websearch_to_tsquery('simple', ${q})) > 0`
          : undefined,
        filters.from
          ? gte(screenshots.capturedAt, new Date(filters.from))
          : undefined,
        filters.to
          ? lt(screenshots.capturedAt, new Date(filters.to))
          : undefined,
        ...tagIds.map(
          (tagId) =>
            sql`EXISTS (SELECT 1 FROM screenshot_tags st WHERE st.screenshot_id=${screenshots.id} AND st.user_id=${ownerId} AND st.tag_id=${tagId})`,
        ),
        after
          ? or(
              lt(rank, after.rank),
              and(
                eq(rank, after.rank),
                or(
                  lt(screenshots.capturedAt, new Date(after.capturedAt)),
                  and(
                    eq(screenshots.capturedAt, new Date(after.capturedAt)),
                    lt(screenshots.id, after.id),
                  ),
                ),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(rank), desc(screenshots.capturedAt), desc(screenshots.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const associatedTags = await tagsForScreenshots(
    database,
    ownerId,
    page.map((row) => row.image.id),
  );
  const items = page.map((row) =>
    screenshotSchema.parse({
      ...screenshotDto(row.image),
      tags: associatedTags.get(row.image.id) ?? [],
    }),
  );
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              owner: ownerId,
              capturedAt: last.capturedAt,
              id: last.id,
              filter: filterHash,
              rank: rows[Math.min(limit, rows.length) - 1]?.rank ?? 0,
            }),
          ).toString('base64url')
        : null,
  };
}
export async function listTags(database: Database, ownerId: string) {
  return database
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, ownerId))
    .orderBy(tags.normalizedName);
}
export async function createTag(
  database: Database,
  ownerId: string,
  name: string,
) {
  await throttle(database, `tags:${ownerId}`, 60);
  const normalizedName = name.normalize('NFKC').toLocaleLowerCase('en-US');
  if (normalizedName.length > 80)
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'The normalized tag name is too long.',
    );
  return database.transaction(async (transaction) => {
    await activeOwner(transaction, ownerId);
    await transaction
      .insert(tags)
      .values({ userId: ownerId, name, normalizedName })
      .onConflictDoNothing();
    const [tag] = await transaction
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(
        and(eq(tags.userId, ownerId), eq(tags.normalizedName, normalizedName)),
      );
    if (!tag) throw missing();
    return tag;
  });
}
export async function updateScreenshot(
  database: Database,
  ownerId: string,
  id: string,
  patch: ScreenshotPatch,
) {
  await database.transaction(async (transaction) => {
    await activeOwner(transaction, ownerId);
    const [image] = await transaction
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
    if (!image) throw missing();
    if (patch.tagIds !== undefined) {
      const owned = patch.tagIds.length
        ? await transaction
            .select({ id: tags.id })
            .from(tags)
            .where(
              and(eq(tags.userId, ownerId), inArray(tags.id, patch.tagIds)),
            )
        : [];
      if (owned.length !== patch.tagIds.length)
        throw new HttpError(404, 'NOT_FOUND', 'Tag not found.');
      await transaction
        .delete(screenshotTags)
        .where(eq(screenshotTags.screenshotId, id));
      if (owned.length)
        await transaction.insert(screenshotTags).values(
          owned.map((tag) => ({
            userId: ownerId,
            screenshotId: id,
            tagId: tag.id,
          })),
        );
    }
    const title = patch.title ?? image.title!;
    await transaction
      .update(screenshots)
      .set({
        title,
        searchVector: sql`setweight(to_tsvector('simple', ${title}), 'A') || setweight(to_tsvector('simple', coalesce((SELECT string_agg(t.name, ' ') FROM tags t JOIN screenshot_tags st ON st.tag_id=t.id AND st.user_id=t.user_id WHERE st.user_id=${ownerId} AND st.screenshot_id=${id}), '')), 'B') || setweight(to_tsvector('simple', ${image.ocrText ?? ''}), 'C')`,
      })
      .where(eq(screenshots.id, id));
  });
  return getScreenshot(database, ownerId, id);
}
export async function deleteScreenshot(
  database: Database,
  ownerId: string,
  id: string,
) {
  await database.transaction(async (transaction) => {
    await activeOwner(transaction, ownerId);
    const [image] = await transaction
      .select()
      .from(screenshots)
      .where(and(eq(screenshots.id, id), eq(screenshots.userId, ownerId)))
      .for('update');
    if (!image) throw missing();
    if (image.deletedAt) return;
    if (image.objectKey)
      await enqueueCleanup(
        transaction,
        image.objectKey,
        ownerId,
        'screenshot_deleted',
      );
    const shares = await transaction
      .select()
      .from(screenshotShares)
      .where(eq(screenshotShares.screenshotId, id));
    for (const share of shares)
      await enqueueCleanup(
        transaction,
        share.previewObjectKey,
        ownerId,
        'screenshot_deleted',
      );
    const sessions = await transaction
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.screenshotId, id));
    for (const session of sessions) {
      await enqueueCleanup(
        transaction,
        session.stagingKey,
        ownerId,
        'screenshot_deleted',
        new Date(session.latestPutExpiresAt.getTime() + 60000),
      );
      await enqueueCleanup(
        transaction,
        session.finalKey,
        ownerId,
        'screenshot_deleted',
        new Date(Date.now() + 300000),
      );
    }
    await transaction
      .update(screenshots)
      .set({
        deletedAt: new Date(),
        title: null,
        ocrText: null,
        searchVector: null,
      })
      .where(eq(screenshots.id, id));
    await transaction
      .update(screenshotShares)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(screenshotShares.screenshotId, id),
          isNull(screenshotShares.revokedAt),
        ),
      );
    await transaction
      .delete(screenshotTags)
      .where(eq(screenshotTags.screenshotId, id));
    await transaction
      .update(uploadSessions)
      .set({
        status: 'deleted',
        finalizedAt: null,
        title: 'Deleted capture',
        ocrText: '',
        ocrStatus: 'failed',
      })
      .where(eq(uploadSessions.screenshotId, id));
  });
}
