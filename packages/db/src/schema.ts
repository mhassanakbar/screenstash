import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  timestamp,
  boolean,
  primaryKey,
  unique,
  uniqueIndex,
  index,
  check,
  foreignKey,
  customType,
} from 'drizzle-orm/pg-core';

const date = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
export const ocrStatus = pgEnum('ocr_status', ['complete', 'failed']);
export const uploadStatus = pgEnum('upload_status', [
  'pending',
  'finalized',
  'expired',
  'rejected',
  'deleted',
]);
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: varchar('clerk_user_id', { length: 256 }).notNull().unique(),
  createdAt: date('created_at').defaultNow().notNull(),
  deletedAt: date('deleted_at'),
});
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    installationId: uuid('installation_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    lastSeenAt: date('last_seen_at').defaultNow().notNull(),
  },
  (table) => [
    unique('devices_owner_installation').on(table.userId, table.installationId),
    unique('devices_owner_identity').on(table.userId, table.id),
  ],
);
export const screenshots = pgTable(
  'screenshots',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: uuid('device_id'),
    captureId: uuid('capture_id').notNull(),
    title: varchar('title', { length: 200 }),
    objectKey: text('object_key').unique(),
    mimeType: varchar('mime_type', { length: 32 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    sha256: varchar('sha256', { length: 64 }),
    ocrText: text('ocr_text'),
    ocrStatus: ocrStatus('ocr_status'),
    ocrTruncated: boolean('ocr_truncated').default(false).notNull(),
    capturedAt: date('captured_at'),
    createdAt: date('created_at').defaultNow().notNull(),
    deletedAt: date('deleted_at'),
    searchVector: tsvector('search_vector'),
  },
  (table) => [
    unique('screenshots_owner_capture').on(table.userId, table.captureId),
    unique('screenshots_owner_identity').on(table.userId, table.id),
    foreignKey({
      name: 'screenshots_owned_device',
      columns: [table.userId, table.deviceId],
      foreignColumns: [devices.userId, devices.id],
    }),
    index('screenshots_owner_date')
      .on(table.userId, table.capturedAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index('screenshots_search').using('gin', table.searchVector),
    check(
      'screenshots_active_metadata',
      sql`${table.deletedAt} IS NOT NULL OR (${table.title} IS NOT NULL AND length(${table.title}) > 0 AND ${table.objectKey} IS NOT NULL AND ${table.capturedAt} IS NOT NULL AND ${table.sha256} IS NOT NULL AND ${table.ocrText} IS NOT NULL AND ${table.ocrStatus} IS NOT NULL AND ${table.width} IS NOT NULL AND ${table.height} IS NOT NULL AND ${table.sizeBytes} IS NOT NULL AND ${table.mimeType} IS NOT NULL)`,
    ),
    check(
      'screenshots_image_bounds',
      sql`${table.width} BETWEEN 1 AND 16384 AND ${table.height} BETWEEN 1 AND 16384 AND ${table.width}::bigint * ${table.height} <= 40000000 AND ${table.sizeBytes} BETWEEN 1 AND 20971520`,
    ),
    check('screenshots_png', sql`${table.mimeType} = 'image/png'`),
    check('screenshots_checksum', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
    check(
      'screenshots_ocr_bounds',
      sql`length(${table.ocrText}) <= 200000 AND (${table.ocrStatus} <> 'failed' OR ${table.ocrText} = '')`,
    ),
  ],
);
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 40 }).notNull(),
    normalizedName: varchar('normalized_name', { length: 80 }).notNull(),
  },
  (table) => [
    unique('tags_owner_name').on(table.userId, table.normalizedName),
    unique('tags_owner_identity').on(table.userId, table.id),
    check(
      'tags_not_empty',
      sql`length(trim(${table.name})) > 0 AND length(${table.normalizedName}) > 0`,
    ),
  ],
);
export const screenshotTags = pgTable(
  'screenshot_tags',
  {
    userId: uuid('user_id').notNull(),
    screenshotId: uuid('screenshot_id').notNull(),
    tagId: uuid('tag_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.screenshotId, table.tagId] }),
    foreignKey({
      name: 'screenshot_tags_owned_screenshot',
      columns: [table.userId, table.screenshotId],
      foreignColumns: [screenshots.userId, screenshots.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'screenshot_tags_owned_tag',
      columns: [table.userId, table.tagId],
      foreignColumns: [tags.userId, tags.id],
    }).onDelete('cascade'),
    index('screenshot_tags_reverse').on(
      table.userId,
      table.tagId,
      table.screenshotId,
    ),
  ],
);
export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: uuid('device_id'),
    captureId: uuid('capture_id').notNull(),
    screenshotId: uuid('screenshot_id').notNull().unique(),
    status: uploadStatus('status').default('pending').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    stagingKey: text('staging_key').notNull().unique(),
    finalKey: text('final_key').notNull().unique(),
    title: varchar('title', { length: 200 }).notNull(),
    mimeType: varchar('mime_type', { length: 32 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    ocrText: text('ocr_text').notNull(),
    ocrStatus: ocrStatus('ocr_status').notNull(),
    ocrTruncated: boolean('ocr_truncated').notNull().default(false),
    capturedAt: date('captured_at').notNull(),
    createdAt: date('created_at').defaultNow().notNull(),
    expiresAt: date('expires_at').notNull(),
    latestPutExpiresAt: date('latest_put_expires_at').notNull(),
    finalizedAt: date('finalized_at'),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: date('lease_expires_at'),
  },
  (table) => [
    unique('uploads_owner_capture').on(table.userId, table.captureId),
    foreignKey({
      name: 'uploads_owned_device',
      columns: [table.userId, table.deviceId],
      foreignColumns: [devices.userId, devices.id],
    }),
    index('uploads_expiry')
      .on(table.expiresAt)
      .where(sql`${table.status} <> 'finalized'`),
    check(
      'uploads_image_bounds',
      sql`${table.width} BETWEEN 1 AND 16384 AND ${table.height} BETWEEN 1 AND 16384 AND ${table.width}::bigint * ${table.height} <= 40000000 AND ${table.sizeBytes} BETWEEN 1 AND 20971520`,
    ),
    check(
      'uploads_metadata',
      sql`${table.mimeType} = 'image/png' AND ${table.sha256} ~ '^[a-f0-9]{64}$' AND length(trim(${table.title})) > 0 AND length(${table.ocrText}) <= 200000 AND (${table.ocrStatus} <> 'failed' OR ${table.ocrText} = '')`,
    ),
    check(
      'uploads_expiry_order',
      sql`${table.latestPutExpiresAt} <= ${table.expiresAt}`,
    ),
    check(
      'uploads_lease_pair',
      sql`(${table.leaseToken} IS NULL) = (${table.leaseExpiresAt} IS NULL)`,
    ),
    check(
      'uploads_finalization_state',
      sql`(${table.status} = 'finalized') = (${table.finalizedAt} IS NOT NULL)`,
    ),
  ],
);
export const screenshotShares = pgTable(
  'screenshot_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    screenshotId: uuid('screenshot_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    publicTitle: varchar('public_title', { length: 120 }).notNull(),
    previewObjectKey: text('preview_object_key').notNull().unique(),
    createdAt: date('created_at').defaultNow().notNull(),
    revokedAt: date('revoked_at'),
  },
  (table) => [
    foreignKey({
      name: 'shares_owned_screenshot',
      columns: [table.userId, table.screenshotId],
      foreignColumns: [screenshots.userId, screenshots.id],
    }),
    uniqueIndex('shares_one_active')
      .on(table.screenshotId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('shares_owner').on(table.userId),
    check(
      'shares_valid_metadata',
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$' AND length(trim(${table.publicTitle})) > 0`,
    ),
  ],
);
export const webhookEvents = pgTable('webhook_events', {
  eventId: varchar('event_id', { length: 256 }).primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  processedAt: date('processed_at').defaultNow().notNull(),
});
export const cleanupJobs = pgTable(
  'cleanup_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    objectKey: text('object_key').notNull(),
    reason: varchar('reason', { length: 100 }).notNull(),
    notBefore: date('not_before').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    nextAttemptAt: date('next_attempt_at').notNull(),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: date('lease_expires_at'),
    completedAt: date('completed_at'),
    createdAt: date('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('cleanup_pending_object')
      .on(table.objectKey)
      .where(sql`${table.completedAt} IS NULL`),
    index('cleanup_due')
      .on(table.nextAttemptAt, table.notBefore)
      .where(sql`${table.completedAt} IS NULL`),
    check('cleanup_attempts_nonnegative', sql`${table.attempts} >= 0`),
    check(
      'cleanup_lease_pair',
      sql`(${table.leaseToken} IS NULL) = (${table.leaseExpiresAt} IS NULL)`,
    ),
  ],
);
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: varchar('key', { length: 256 }).primaryKey(),
    count: integer('count').notNull(),
    expiresAt: date('expires_at').notNull(),
  },
  (table) => [
    index('rate_limits_expiry').on(table.expiresAt),
    check('rate_limits_positive', sql`${table.count} > 0`),
  ],
);
