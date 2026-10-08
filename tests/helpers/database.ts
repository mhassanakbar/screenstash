import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from 'dotenv';
import { Pool } from 'pg';

export interface SqlDatabase {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  exec: (text: string) => Promise<unknown>;
}
export async function migrationSql(schemaName?: string) {
  const directory = path.resolve('packages/db/migrations');
  const files = (await readdir(directory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const sql = (
    await Promise.all(
      files.map((file) => readFile(path.join(directory, file), 'utf8')),
    )
  ).join('\n');
  return schemaName ? sql.replaceAll('"public".', `"${schemaName}".`) : sql;
}
function identity(value: string) {
  const url = new URL(value);
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}
export async function temporaryPostgres() {
  config({ path: path.resolve('apps/api/.env'), override: false, quiet: true });
  const suppliedTest = process.env.TEST_DATABASE_URL;
  const direct = process.env.DIRECT_DATABASE_URL;
  if (suppliedTest) {
    for (const runtime of [process.env.DATABASE_URL, direct]) {
      if (runtime && identity(runtime) === identity(suppliedTest))
        throw new Error(
          'TEST_DATABASE_URL must target a separate disposable database',
        );
    }
    const pool = new Pool({
      connectionString: suppliedTest,
      max: 5,
      connectionTimeoutMillis: 5000,
    });
    const schemaName = `screenstash_test_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE SCHEMA "${schemaName}"`);
    await pool.end();
    const isolated = new Pool({
      connectionString: suppliedTest,
      max: 5,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schemaName}`,
    });
    return {
      pool: isolated,
      schemaName,
      async close() {
        try {
          await isolated.query(`DROP SCHEMA "${schemaName}" CASCADE`);
        } finally {
          await isolated.end();
        }
      },
    };
  }
  if (!direct)
    throw new Error(
      'Configure TEST_DATABASE_URL or a local DIRECT_DATABASE_URL for integration tests',
    );
  const url = new URL(direct);
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
    throw new Error(
      'Automatic test database creation is allowed only on the configured local PostgreSQL instance',
    );
  }
  url.pathname = '/postgres';
  const admin = new Pool({
    connectionString: url.toString(),
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const name = `screenstash_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch {
    await admin.end();
    throw new Error(
      'Unable to create an isolated local test database. Configure a disposable TEST_DATABASE_URL or grant the local role CREATEDB',
    );
  }
  url.pathname = `/${name}`;
  const pool = new Pool({
    connectionString: url.toString(),
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  return {
    pool,
    schemaName: undefined,
    async close() {
      await pool.end();
      try {
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    },
  };
}
