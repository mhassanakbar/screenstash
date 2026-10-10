import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { createDatabase } from '@screenstash/db';

config({ path: path.resolve('apps/api/.env'), override: false, quiet: true });
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error('Database configuration is required.');
  const connection = createDatabase(process.env.DATABASE_URL);
  try {
    const result = await connection.pool
      .query(`SELECT j.id,j.object_key,j.reason,j.created_at,j.not_before,j.next_attempt_at,
      (u.deleted_at IS NOT NULL) AS owner_deleted,
      EXISTS(SELECT 1 FROM screenshots s WHERE s.object_key=j.object_key AND s.deleted_at IS NULL) AS active_original,
      EXISTS(SELECT 1 FROM screenshot_shares s WHERE s.preview_object_key=j.object_key AND s.revoked_at IS NULL) AS active_preview,
      EXISTS(SELECT 1 FROM upload_sessions s WHERE s.final_key=j.object_key AND s.lease_expires_at>now()) AS active_write,
      (j.not_before<=now() AND j.next_attempt_at<=now() AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=now())) AS due
      FROM cleanup_jobs j JOIN users u ON u.id=j.user_id WHERE j.completed_at IS NULL ORDER BY j.created_at LIMIT 200`);
    const directory = path.resolve('test-results');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'cleanup-review.json'),
      JSON.stringify(
        {
          reviewedAt: new Date().toISOString(),
          limit: 200,
          storageExistenceChecked: false,
          jobs: result.rows,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      JSON.stringify({
        reviewed: result.rows.length,
        due: result.rows.filter((row) => row.due).length,
        protected: result.rows.filter(
          (row) =>
            row.active_original || row.active_preview || row.active_write,
        ).length,
        ownersDeleted: result.rows.filter((row) => row.owner_deleted).length,
        manifest: 'test-results/cleanup-review.json',
        destructiveActions: 0,
      }),
    );
  } finally {
    await connection.pool.end();
  }
}
main().catch(() => {
  console.error(
    'Cleanup review unavailable. Check database access and applied migrations.',
  );
  process.exitCode = 1;
});
