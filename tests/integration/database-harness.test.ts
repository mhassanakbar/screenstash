import { expect, it } from 'vitest';
import { temporaryPostgres, migrationSql } from '../helpers/database.js';

it('isolates supplied disposable URLs in removable schemas', async () => {
  const outer = await temporaryPostgres();
  const previous = process.env.TEST_DATABASE_URL;
  let inner: Awaited<ReturnType<typeof temporaryPostgres>> | undefined;
  try {
    const connection = outer.pool.options.connectionString;
    if (!connection)
      throw new Error('The isolated test connection is unavailable.');
    process.env.TEST_DATABASE_URL = connection;
    inner = await temporaryPostgres();
    expect(inner.schemaName).toMatch(/^screenstash_test_[a-f0-9]{32}$/);
    await inner.pool.query(await migrationSql(inner.schemaName));
    await inner.pool.query(
      "INSERT INTO users (clerk_user_id) VALUES ('schema_fixture')",
    );
    expect(
      (await inner.pool.query('SELECT clerk_user_id FROM users')).rows[0]
        .clerk_user_id,
    ).toBe('schema_fixture');
    const schemaName = inner.schemaName;
    await inner.close();
    inner = undefined;
    expect(
      (
        await outer.pool.query(
          'SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1',
          [schemaName],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = previous;
    if (inner) await inner.close();
    await outer.close();
  }
});
