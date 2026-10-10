import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { createClerkClient } from '@clerk/backend';

try {
  const api = parse(await readFile('apps/api/.env', 'utf8'));
  if (!api.CLERK_SECRET_KEY?.startsWith('sk_test_'))
    throw new Error('Development credentials required');
  const file = 'apps/desktop/.env',
    content = await readFile(file, 'utf8'),
    desktop = parse(content);
  if (
    !desktop.VITE_CLERK_PUBLISHABLE_KEY ||
    desktop.VITE_CLERK_PUBLISHABLE_KEY !== api.CLERK_PUBLISHABLE_KEY
  )
    throw new Error('Matching development instance required');
  const decoded = Buffer.from(
    desktop.VITE_CLERK_PUBLISHABLE_KEY.slice(8),
    'base64',
  ).toString();
  const host = decoded.endsWith(String.fromCharCode(36))
    ? decoded.slice(0, -1)
    : decoded;
  if (!/^[a-z0-9.-]+$/i.test(host))
    throw new Error('Invalid Frontend API hostname');
  const clerk = createClerkClient({ secretKey: api.CLERK_SECRET_KEY }),
    instance = await clerk.instance.get();
  if (instance.environmentType !== 'development')
    throw new Error('Development instance required');
  await clerk.instance.update({
    allowedOrigins: [
      ...new Set([
        ...(instance.allowedOrigins ?? []),
        api.WEB_ORIGIN ?? 'http://localhost:3000',
        'http://localhost:5173',
        'screenstash://renderer',
      ]),
    ],
  });
  if (!desktop.VITE_CLERK_FRONTEND_API_HOST)
    await writeFile(
      file,
      content.trimEnd() + `\nVITE_CLERK_FRONTEND_API_HOST=${host}\n`,
    );
  console.log(
    'Development desktop origins configured; existing origins preserved. Local Frontend API hostname configured.',
  );
} catch {
  console.error(
    'Desktop development configuration failed. Check matching development credentials; no credentials were printed.',
  );
  process.exitCode = 1;
}
import { Buffer } from 'node:buffer';
