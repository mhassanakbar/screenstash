import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';

const file = path.resolve('apps/api/.env');
const content = await readFile(file, 'utf8');
const values = parse(content);
if (values.CRON_SECRET) {
  if (values.CRON_SECRET.length < 32)
    throw new Error(
      'The existing maintenance secret is too short; configure a value of at least 32 characters.',
    );
  console.log('The existing maintenance secret was preserved.');
} else {
  const line = `CRON_SECRET=${randomBytes(32).toString('base64url')}`;
  const updated = /^\s*CRON_SECRET\s*=/m.test(content)
    ? content.replace(/^\s*CRON_SECRET\s*=.*$/m, line)
    : `${content.trimEnd()}\n${line}\n`;
  await writeFile(file, updated, 'utf8');
  console.log(
    'A maintenance secret was configured in the ignored API environment file.',
  );
}
