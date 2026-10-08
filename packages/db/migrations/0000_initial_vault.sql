CREATE TYPE "public"."ocr_status" AS ENUM('complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'finalized', 'expired', 'rejected', 'deleted');--> statement-breakpoint
CREATE TABLE "cleanup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"object_key" text NOT NULL,
	"reason" varchar(100) NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cleanup_attempts_nonnegative" CHECK ("cleanup_jobs"."attempts" >= 0),
	CONSTRAINT "cleanup_lease_pair" CHECK (("cleanup_jobs"."lease_token" IS NULL) = ("cleanup_jobs"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_owner_installation" UNIQUE("user_id","installation_id"),
	CONSTRAINT "devices_owner_identity" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(256) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_positive" CHECK ("rate_limits"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "screenshot_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"screenshot_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"public_title" varchar(120) NOT NULL,
	"preview_object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "screenshot_shares_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "screenshot_shares_preview_object_key_unique" UNIQUE("preview_object_key"),
	CONSTRAINT "shares_valid_metadata" CHECK ("screenshot_shares"."token_hash" ~ '^[a-f0-9]{64}$' AND length(trim("screenshot_shares"."public_title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "screenshot_tags" (
	"user_id" uuid NOT NULL,
	"screenshot_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "screenshot_tags_screenshot_id_tag_id_pk" PRIMARY KEY("screenshot_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "screenshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"capture_id" uuid NOT NULL,
	"title" varchar(200),
	"object_key" text,
	"mime_type" varchar(32),
	"size_bytes" bigint,
	"width" integer,
	"height" integer,
	"sha256" varchar(64),
	"ocr_text" text,
	"ocr_status" "ocr_status",
	"ocr_truncated" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"search_vector" "tsvector",
	CONSTRAINT "screenshots_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "screenshots_owner_capture" UNIQUE("user_id","capture_id"),
	CONSTRAINT "screenshots_owner_identity" UNIQUE("user_id","id"),
	CONSTRAINT "screenshots_active_metadata" CHECK ("screenshots"."deleted_at" IS NOT NULL OR ("screenshots"."title" IS NOT NULL AND length("screenshots"."title") > 0 AND "screenshots"."object_key" IS NOT NULL AND "screenshots"."captured_at" IS NOT NULL AND "screenshots"."sha256" IS NOT NULL AND "screenshots"."ocr_text" IS NOT NULL AND "screenshots"."ocr_status" IS NOT NULL AND "screenshots"."width" IS NOT NULL AND "screenshots"."height" IS NOT NULL AND "screenshots"."size_bytes" IS NOT NULL AND "screenshots"."mime_type" IS NOT NULL)),
	CONSTRAINT "screenshots_image_bounds" CHECK ("screenshots"."width" BETWEEN 1 AND 16384 AND "screenshots"."height" BETWEEN 1 AND 16384 AND "screenshots"."width"::bigint * "screenshots"."height" <= 40000000 AND "screenshots"."size_bytes" BETWEEN 1 AND 20971520),
	CONSTRAINT "screenshots_png" CHECK ("screenshots"."mime_type" = 'image/png'),
	CONSTRAINT "screenshots_checksum" CHECK ("screenshots"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "screenshots_ocr_bounds" CHECK (length("screenshots"."ocr_text") <= 200000 AND ("screenshots"."ocr_status" <> 'failed' OR "screenshots"."ocr_text" = ''))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(40) NOT NULL,
	"normalized_name" varchar(80) NOT NULL,
	CONSTRAINT "tags_owner_name" UNIQUE("user_id","normalized_name"),
	CONSTRAINT "tags_owner_identity" UNIQUE("user_id","id"),
	CONSTRAINT "tags_not_empty" CHECK (length(trim("tags"."name")) > 0 AND length("tags"."normalized_name") > 0)
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"capture_id" uuid NOT NULL,
	"screenshot_id" uuid NOT NULL,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"attempt_id" uuid NOT NULL,
	"staging_key" text NOT NULL,
	"final_key" text NOT NULL,
	"title" varchar(200) NOT NULL,
	"mime_type" varchar(32) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"ocr_text" text NOT NULL,
	"ocr_status" "ocr_status" NOT NULL,
	"ocr_truncated" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"latest_put_expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	CONSTRAINT "upload_sessions_screenshot_id_unique" UNIQUE("screenshot_id"),
	CONSTRAINT "upload_sessions_staging_key_unique" UNIQUE("staging_key"),
	CONSTRAINT "upload_sessions_final_key_unique" UNIQUE("final_key"),
	CONSTRAINT "uploads_owner_capture" UNIQUE("user_id","capture_id"),
	CONSTRAINT "uploads_image_bounds" CHECK ("upload_sessions"."width" BETWEEN 1 AND 16384 AND "upload_sessions"."height" BETWEEN 1 AND 16384 AND "upload_sessions"."width"::bigint * "upload_sessions"."height" <= 40000000 AND "upload_sessions"."size_bytes" BETWEEN 1 AND 20971520),
	CONSTRAINT "uploads_metadata" CHECK ("upload_sessions"."mime_type" = 'image/png' AND "upload_sessions"."sha256" ~ '^[a-f0-9]{64}$' AND length(trim("upload_sessions"."title")) > 0 AND length("upload_sessions"."ocr_text") <= 200000 AND ("upload_sessions"."ocr_status" <> 'failed' OR "upload_sessions"."ocr_text" = '')),
	CONSTRAINT "uploads_expiry_order" CHECK ("upload_sessions"."latest_put_expires_at" <= "upload_sessions"."expires_at"),
	CONSTRAINT "uploads_lease_pair" CHECK (("upload_sessions"."lease_token" IS NULL) = ("upload_sessions"."lease_expires_at" IS NULL)),
	CONSTRAINT "uploads_finalization_state" CHECK (("upload_sessions"."status" = 'finalized') = ("upload_sessions"."finalized_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" varchar(256) PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cleanup_jobs" ADD CONSTRAINT "cleanup_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_shares" ADD CONSTRAINT "shares_owned_screenshot" FOREIGN KEY ("user_id","screenshot_id") REFERENCES "public"."screenshots"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_tags" ADD CONSTRAINT "screenshot_tags_owned_screenshot" FOREIGN KEY ("user_id","screenshot_id") REFERENCES "public"."screenshots"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_tags" ADD CONSTRAINT "screenshot_tags_owned_tag" FOREIGN KEY ("user_id","tag_id") REFERENCES "public"."tags"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_owned_device" FOREIGN KEY ("user_id","device_id") REFERENCES "public"."devices"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "uploads_owned_device" FOREIGN KEY ("user_id","device_id") REFERENCES "public"."devices"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cleanup_pending_object" ON "cleanup_jobs" USING btree ("object_key") WHERE "cleanup_jobs"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "cleanup_due" ON "cleanup_jobs" USING btree ("next_attempt_at","not_before") WHERE "cleanup_jobs"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "rate_limits_expiry" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shares_one_active" ON "screenshot_shares" USING btree ("screenshot_id") WHERE "screenshot_shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shares_owner" ON "screenshot_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "screenshot_tags_reverse" ON "screenshot_tags" USING btree ("user_id","tag_id","screenshot_id");--> statement-breakpoint
CREATE INDEX "screenshots_owner_date" ON "screenshots" USING btree ("user_id","captured_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "screenshots"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "screenshots_search" ON "screenshots" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "uploads_expiry" ON "upload_sessions" USING btree ("expires_at") WHERE "upload_sessions"."status" <> 'finalized';