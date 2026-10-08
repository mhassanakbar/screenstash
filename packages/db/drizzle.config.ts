import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const directory = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.VERCEL)
  config({
    path: path.resolve(directory, '../../apps/api/.env'),
    override: false,
    quiet: true,
  });
const command = process.argv.includes('generate') ? 'generate' : 'migrate';
const url = process.env.DIRECT_DATABASE_URL;
// Generating SQL is offline; migration credentials are required only for database access.
if (command === 'migrate' && !url)
  throw new Error('DIRECT_DATABASE_URL is required for migrations');
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  ...(url ? { dbCredentials: { url } } : {}),
});
