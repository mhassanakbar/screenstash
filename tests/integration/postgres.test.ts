import { describe, it, expect } from 'vitest';
import { constraintSuite } from '../helpers/constraints.js';
import { temporaryPostgres, migrationSql } from '../helpers/database.js';

constraintSuite('Local/live PostgreSQL constraints', async () => {
  const database = await temporaryPostgres();
  return {
    sql: {
      exec: (text) =>
        database.pool.query(
          database.schemaName
            ? text.replaceAll('"public".', `"${database.schemaName}".`)
            : text,
        ),
      query: (text, values) =>
        database.pool.query<Record<string, unknown>>(text, values),
    },
    close: database.close,
  };
});
describe('PostgreSQL transactions and leases', () => {
  it('rolls back failures and lets concurrent workers claim distinct jobs', async () => {
    const { pool, close, schemaName } = await temporaryPostgres();
    try {
      await pool.query(await migrationSql(schemaName));
      await pool.query(
        "INSERT INTO cleanup_jobs (object_key, reason, not_before, next_attempt_at) VALUES ('fixture/one','test',now(),now()),('fixture/two','test',now(),now())",
      );
      const first = await pool.connect(),
        second = await pool.connect();
      try {
        await first.query('BEGIN');
        await second.query('BEGIN');
        const a = await first.query(
          'SELECT id FROM cleanup_jobs WHERE completed_at IS NULL AND lease_token IS NULL AND not_before <= now() AND next_attempt_at <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1',
        );
        const b = await second.query(
          'SELECT id FROM cleanup_jobs WHERE completed_at IS NULL AND lease_token IS NULL AND not_before <= now() AND next_attempt_at <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1',
        );
        expect(a.rows[0].id).not.toBe(b.rows[0].id);
        await first.query(
          "UPDATE cleanup_jobs SET lease_token=gen_random_uuid(), lease_expires_at=now()+interval '1 minute' WHERE id=$1",
          [a.rows[0].id],
        );
        await first.query('ROLLBACK');
        await second.query('ROLLBACK');
        expect(
          (
            await pool.query(
              'SELECT id FROM cleanup_jobs WHERE lease_token IS NOT NULL',
            )
          ).rowCount,
        ).toBe(0);
      } finally {
        first.release();
        second.release();
      }
    } finally {
      await close();
    }
  });
});
