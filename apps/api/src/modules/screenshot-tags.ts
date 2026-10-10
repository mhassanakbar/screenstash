import { and, eq, inArray } from 'drizzle-orm';
import { tags, screenshotTags, type Database } from '@screenstash/db';

export async function tagsForScreenshots(
  database: Database,
  ownerId: string,
  ids: string[],
) {
  const result = new Map<string, { id: string; name: string }[]>();
  if (!ids.length) return result;
  const rows = await database
    .select({
      screenshotId: screenshotTags.screenshotId,
      id: tags.id,
      name: tags.name,
    })
    .from(tags)
    .innerJoin(
      screenshotTags,
      and(
        eq(screenshotTags.tagId, tags.id),
        eq(screenshotTags.userId, tags.userId),
      ),
    )
    .where(
      and(
        eq(screenshotTags.userId, ownerId),
        inArray(screenshotTags.screenshotId, ids),
      ),
    )
    .orderBy(tags.normalizedName);
  for (const row of rows) {
    const list = result.get(row.screenshotId) ?? [];
    list.push({ id: row.id, name: row.name });
    result.set(row.screenshotId, list);
  }
  return result;
}
