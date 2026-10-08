import { attachDatabasePool } from '@vercel/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export function createDatabase(connectionString: string) {
  if (!connectionString)
    throw new Error('A PostgreSQL connection string is required');
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
  });
  pool.on('error', () => {
    /* Idle connection errors must not crash the process or log connection details. */
  });
  if (process.env.VERCEL) attachDatabasePool(pool);
  return { db: drizzle(pool, { schema }), pool };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export * from './schema.js';
