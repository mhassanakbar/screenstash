import { defineConfig } from 'drizzle-kit';

const url = process.env.DIRECT_DATABASE_URL;
if (!url)
  throw new Error('DIRECT_DATABASE_URL is required for migration tooling');
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url },
});
