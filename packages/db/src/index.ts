import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export function createDatabase(connectionString: string) {
  if (!connectionString)
    throw new Error('A PostgreSQL connection string is required');
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
  });
  return { db: drizzle(pool), pool };
}
