import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

export function loadLocalEnvironment() {
  if (process.env.VERCEL) return;
  // Both src/config/environment.ts and the built dist entry resolve within apps/api.
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(directory, '../../.env'),
    path.resolve(directory, '../.env'),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (file) loadDotEnv({ path: file, override: false, quiet: true });
}
const optional = (schema: z.ZodString) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );
const databaseUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      return ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  });
const origin = z
  .string()
  .url()
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }, 'Expected an HTTP(S) origin');
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  ACCOUNT_STORAGE_BYTES: z.coerce
    .number()
    .int()
    .min(20971520)
    .max(Number.MAX_SAFE_INTEGER)
    .default(1073741824),
  ACCOUNT_PENDING_UPLOADS: z.coerce.number().int().min(1).max(1000).default(25),
  DATABASE_URL: optional(databaseUrl),
  CLERK_PUBLISHABLE_KEY: optional(z.string().min(1)),
  CLERK_SECRET_KEY: optional(z.string().min(1)),
  CLERK_JWT_KEY: optional(z.string().min(1)),
  CLERK_WEBHOOK_SIGNING_SECRET: optional(z.string().min(1)),
  CRON_SECRET: optional(z.string().min(32)),
  R2_ACCOUNT_ID: optional(z.string().min(1)),
  R2_ACCESS_KEY_ID: optional(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: optional(z.string().min(1)),
  R2_BUCKET: optional(z.string().min(1)),
  WEB_ORIGIN: origin.default('http://localhost:3000'),
  PUBLIC_BASE_URL: origin.default('http://localhost:3000'),
});
export class ConfigurationError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Invalid configuration: ${fields.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}
export function parseEnvironment(values: Record<string, unknown>) {
  const parsed = schema.safeParse(values);
  if (!parsed.success)
    throw new ConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  return parsed.data;
}
export type Environment = ReturnType<typeof parseEnvironment>;
export function configuredDependencies(environment: Environment) {
  return {
    database: Boolean(environment.DATABASE_URL),
    authentication: Boolean(
      environment.CLERK_PUBLISHABLE_KEY && environment.CLERK_SECRET_KEY,
    ),
    storage: Boolean(
      environment.R2_ACCOUNT_ID &&
      environment.R2_ACCESS_KEY_ID &&
      environment.R2_SECRET_ACCESS_KEY &&
      environment.R2_BUCKET,
    ),
    webhook: Boolean(environment.CLERK_WEBHOOK_SIGNING_SECRET),
    maintenance: Boolean(environment.CRON_SECRET),
  };
}
