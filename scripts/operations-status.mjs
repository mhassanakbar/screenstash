import path from 'node:path';
import { config } from 'dotenv';
import { createDatabase } from '@screenstash/db';

config({ path: path.resolve('apps/api/.env'), override: false, quiet: true });
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error('Database configuration is required.');
  const connection = createDatabase(process.env.DATABASE_URL);
  try {
    const cleanup = await connection.pool.query(
      'SELECT count(*)::integer AS pending,count(*) FILTER (WHERE not_before<=now() AND next_attempt_at<=now())::integer AS due,count(*) FILTER (WHERE attempts>0)::integer AS retried,min(created_at) AS oldest_pending FROM cleanup_jobs WHERE completed_at IS NULL',
    );
    const uploads = await connection.pool.query(
      "SELECT count(*)::integer AS pending,count(*) FILTER (WHERE expires_at<=now())::integer AS expired FROM upload_sessions WHERE status='pending'",
    );
    const processing = await connection.pool.query(
      "SELECT count(*)::integer AS active FROM rate_limits WHERE key LIKE 'processing:%' AND expires_at>now()",
    );
    console.log(
      JSON.stringify(
        {
          cleanup: cleanup.rows[0],
          uploads: uploads.rows[0],
          processing: processing.rows[0],
          maintenanceConfigured: Boolean(process.env.CRON_SECRET),
          webhookConfigured: Boolean(process.env.CLERK_WEBHOOK_SIGNING_SECRET),
        },
        null,
        2,
      ),
    );
  } finally {
    await connection.pool.end();
  }
}
main().catch(() => {
  console.error(
    'Operations status unavailable. Check database access and applied migrations.',
  );
  process.exitCode = 1;
});
