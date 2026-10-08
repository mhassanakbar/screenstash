import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiClient } from '../packages/api-client/dist/index.js';
import { healthResponseSchema } from '../packages/shared/dist/index.js';
import { createDatabase } from '../packages/db/dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const nextBin = path.join(
  path.dirname(webRequire.resolve('next/package.json')),
  'dist/bin/next',
);
const children = [];
function start(name, entry, args, cwd, env) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  child.on('error', (error) => {
    output += error.message;
  });
  children.push({ child, name, output: () => output });
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt++) {
    for (const item of children) {
      if (item.child.exitCode !== null)
        throw new Error(`${item.name} stopped: ${item.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* Wait for the production server to listen. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

try {
  for (const port of [3000, 4000]) {
    const net = await import('node:net');
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, () => probe.close(resolve));
    });
  }
  assert.equal(
    healthResponseSchema.safeParse({
      status: 'wrong',
      service: 'screenstash-api',
    }).success,
    false,
  );
  const database = createDatabase(
    'postgresql://unused:unused@127.0.0.1:5432/unused',
  );
  assert.ok(database.db);
  await database.pool.end(); // Construction/import only; no database service is needed for the scaffold.

  start('API', path.join(root, 'apps/api/dist/server.js'), [], root, {
    PORT: '4000',
  });
  await waitFor('http://127.0.0.1:4000/api/health');
  start(
    'Next.js',
    nextBin,
    ['start', '--hostname', '127.0.0.1', '--port', '3000'],
    path.join(root, 'apps/web'),
    {},
  );
  await waitFor('http://127.0.0.1:3000');

  for (const origin of ['http://127.0.0.1:4000', 'http://127.0.0.1:3000']) {
    const client = createApiClient({ baseUrl: origin });
    assert.deepEqual(await client.health(), {
      status: 'ok',
      service: 'screenstash-api',
    });
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    const head = await fetch(`${origin}/api/health`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const missing = await fetch(`${origin}/api/missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  }
  for (const route of ['/s/scaffold/image', '/s/scaffold/preview.jpg']) {
    const missing = await fetch(`http://127.0.0.1:3000${route}`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  }
  const page = await fetch('http://127.0.0.1:3000');
  assert.match(await page.text(), /ScreenStash/);
  console.log(
    'PASS: compiled packages, API, Next.js production page, API/media rewrites, HEAD, and no-store headers.',
  );
} finally {
  await Promise.all(
    children.map(async ({ child }) => {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }),
  );
}
