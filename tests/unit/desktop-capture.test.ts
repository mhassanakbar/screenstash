import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  access,
  rename,
} from 'node:fs/promises';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureRepository } from '../../apps/desktop/src/main/capture/repository';
import { physicalRectangle } from '../../apps/desktop/src/main/capture/geometry';
import type { CaptureIdentity } from '../../apps/desktop/src/contracts/capture';

const base = path.resolve('test-results');
const directories: string[] = [];
async function repository() {
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'capture-unit-'));
  directories.push(directory);
  const store = new CaptureRepository(directory);
  await store.initialize();
  return { directory, store };
}
const image = () =>
  sharp({
    create: { width: 24, height: 16, channels: 3, background: '#228844' },
  })
    .png()
    .toBuffer();
const identity = (): CaptureIdentity => ({
  owner: { id: randomUUID(), clerkUserId: `user_${randomUUID()}` },
  device: {
    id: randomUUID(),
    installationId: randomUUID(),
    name: 'Test',
    lastSeenAt: new Date().toISOString(),
  },
});
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(path.resolve(directory)) !== base ||
      !path.basename(directory).startsWith('capture-unit-')
    )
      throw new Error('Unexpected cleanup target');
    await rm(directory, { recursive: true, force: true });
  }
});
describe('Durable local screenshot repository', () => {
  it('persists exact PNGs and owner binding across restart without exposing another account', async () => {
    const { directory, store } = await repository();
    const first = identity(),
      second = identity(),
      bytes = await image();
    await store.setIdentity(first);
    const owned = await store.save(
      bytes,
      'region',
      new Date().toISOString(),
      store.currentIdentity(),
    );
    expect(await readFile(await store.imagePath(owned.id))).toEqual(bytes);
    const restarted = new CaptureRepository(directory);
    await restarted.initialize();
    expect(restarted.list()[0]?.id).toBe(owned.id);
    const unassigned = await restarted.save(
      bytes,
      'display',
      new Date().toISOString(),
      null,
    );
    await restarted.setIdentity(second);
    expect(restarted.list().map((item) => item.id)).toEqual([unassigned.id]);
    await expect(restarted.imagePath(owned.id)).rejects.toThrow();
    await restarted.setIdentity(null);
    expect(restarted.currentIdentity()).toBeNull();
    expect(restarted.list()[0]?.assigned).toBe(false);
    await restarted.setIdentity(first);
    expect(restarted.list()).toHaveLength(2);
    const record = JSON.parse(
      await readFile(path.join(directory, 'queue', `${owned.id}.json`), 'utf8'),
    );
    expect(record.identity.owner.id).toBe(first.owner.id);
  });
  it('recovers a damaged primary from backup, retains interrupted files, and detects changed PNG bytes', async () => {
    const { directory, store } = await repository();
    const captured = await store.save(
      await image(),
      'display',
      new Date().toISOString(),
      null,
    );
    await writeFile(
      path.join(directory, 'queue', `${captured.id}.json`),
      '{partial',
    );
    await writeFile(
      path.join(directory, 'queue', `${captured.id}.json.interrupted.tmp`),
      '{partial',
    );
    const recovered = new CaptureRepository(directory);
    await recovered.initialize();
    expect(recovered.list()[0]?.id).toBe(captured.id);
    expect(recovered.warnings).toBe(2);
    const changed = await image();
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    await writeFile(
      path.join(directory, 'captures', `${captured.id}.png`),
      changed,
    );
    const damaged = new CaptureRepository(directory);
    await damaged.initialize();
    expect(damaged.list()).toEqual([]);
    expect(damaged.warnings).toBeGreaterThan(0);
    await expect(
      access(path.join(directory, 'captures', `${captured.id}.png`)),
    ).resolves.toBeUndefined();
  });
  it('recovers an orphan as unassigned and never downgrades a future schema or accepts manifest traversal', async () => {
    const { directory, store } = await repository();
    const first = identity();
    await store.setIdentity(first);
    const orphanId = randomUUID();
    await writeFile(
      path.join(directory, 'captures', `${orphanId}.png`),
      await image(),
    );
    const owned = await store.save(
      await image(),
      'region',
      new Date().toISOString(),
      first,
    );
    const manifest = path.join(directory, 'queue', `${owned.id}.json`);
    const record = JSON.parse(await readFile(manifest, 'utf8'));
    await writeFile(manifest, JSON.stringify({ ...record, schemaVersion: 2 }));
    const recovered = new CaptureRepository(directory);
    await recovered.initialize();
    expect(recovered.list()).toMatchObject([{ id: orphanId, assigned: false }]);
    expect(JSON.parse(await readFile(manifest, 'utf8')).schemaVersion).toBe(2);
    await writeFile(
      manifest,
      JSON.stringify({ ...record, png: '../private.png' }),
    );
    await rm(`${manifest}.bak`);
    const traversal = new CaptureRepository(directory);
    await traversal.initialize();
    expect(traversal.list().map((item) => item.id)).toEqual([orphanId]);
    await expect(traversal.imagePath('../private.png')).rejects.toThrow();
  });
  it('does not report a saved capture when persistence fails and rejects missing files', async () => {
    const { directory, store } = await repository();
    const capture = await store.save(
      await image(),
      'display',
      new Date().toISOString(),
      null,
    );
    await rm(path.join(directory, 'captures', `${capture.id}.png`));
    await expect(store.imagePath(capture.id)).rejects.toThrow();
    const brokenDirectory = path.join(directory, 'broken');
    const broken = new CaptureRepository(brokenDirectory);
    await expect(
      broken.save(await image(), 'display', new Date().toISOString(), null),
    ).rejects.toThrow();
    expect(broken.list()).toEqual([]);
  });
  it('serializes parallel saves without overwriting captures or leaking credentials into manifests', async () => {
    const { directory, store } = await repository(),
      bytes = await image();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        store.save(bytes, 'display', new Date().toISOString(), null),
      ),
    );
    expect(new Set(results.map((item) => item.id)).size).toBe(4);
    expect(store.localBytes).toBe(bytes.length * 4);
    for (const result of results) {
      const record = await readFile(
        path.join(directory, 'queue', `${result.id}.json`),
        'utf8',
      );
      expect(record).not.toMatch(/Bearer|token|https?:\/\//);
    }
  });
  it('retains a committed PNG when the first manifest write fails and recovers it without guessing ownership', async () => {
    const { directory, store } = await repository();
    await store.setIdentity(identity());
    const queue = path.join(directory, 'queue'),
      parked = path.join(directory, 'queue-parked');
    await rename(queue, parked);
    await writeFile(queue, 'Blocked storage fixture');
    await expect(
      store.save(
        await image(),
        'display',
        new Date().toISOString(),
        store.currentIdentity(),
      ),
    ).rejects.toThrow();
    expect(store.list()).toEqual([]);
    await rm(queue);
    await rename(parked, queue);
    const recovered = new CaptureRepository(directory);
    await recovered.initialize();
    expect(recovered.list()).toHaveLength(1);
    expect(recovered.list()[0]?.assigned).toBe(false);
    expect(recovered.warnings).toBe(1);
  });
});
describe('Display-relative region mapping', () => {
  it('maps all corners and fractional edges correctly at common DPI scales', () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
      const display = { width: 1000, height: 800 },
        frame = { width: 1000 * scale, height: 800 * scale };
      expect(
        physicalRectangle(
          { x: 0, y: 0, width: 1000, height: 800 },
          display,
          frame,
        ),
      ).toEqual({ x: 0, y: 0, ...frame });
      expect(
        physicalRectangle(
          { x: 900, y: 700, width: 100, height: 100 },
          display,
          frame,
        ),
      ).toEqual({
        x: 900 * scale,
        y: 700 * scale,
        width: 100 * scale,
        height: 100 * scale,
      });
      const area = physicalRectangle(
        { x: 0.4, y: 0.4, width: 2.2, height: 2.2 },
        display,
        frame,
      );
      expect(area.x).toBe(Math.floor(0.4 * scale));
      expect(area.width).toBe(Math.ceil(2.6 * scale) - area.x);
    }
  });
  it('rejects degenerate, nonfinite, forged and cross-display coordinates', () => {
    const dimensions = { width: 1000, height: 800 };
    for (const area of [
      { x: -10, y: 0, width: 20, height: 20 },
      { x: 990, y: 0, width: 20, height: 20 },
      { x: 0, y: 0, width: 1, height: 20 },
      { x: NaN, y: 0, width: 20, height: 20 },
      { x: 0, y: 0, width: -20, height: 20 },
    ])
      expect(() => physicalRectangle(area, dimensions, dimensions)).toThrow();
  });
});
