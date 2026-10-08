import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { screenshots, users, type Database } from '@screenstash/db';
import { idSchema, meSchema } from '@screenstash/shared';
import type { ObjectStore } from '../storage/r2.js';
import { HttpError } from '../middleware/errors.js';

export function privateMedia(database?: Database, store?: ObjectStore) {
  const router = Router();
  router.get(
    ['/api/screenshots/:id/image', '/api/screenshots/:id/download'],
    async (req, res) => {
      if (!database || !store)
        throw new HttpError(
          503,
          'DEPENDENCY_UNAVAILABLE',
          'Image services are unavailable.',
          true,
        );
      const owner = meSchema.parse(res.locals.owner),
        id = idSchema.parse(req.params.id);
      const [result] = await database
        .select({ image: screenshots })
        .from(screenshots)
        .innerJoin(users, eq(users.id, screenshots.userId))
        .where(
          and(
            eq(screenshots.id, id),
            eq(screenshots.userId, owner.id),
            isNull(screenshots.deletedAt),
            isNull(users.deletedAt),
          ),
        );
      if (!result?.image.objectKey)
        throw new HttpError(404, 'NOT_FOUND', 'Screenshot not found.');
      const image = result.image;
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      const download =
        req.method === 'HEAD'
          ? undefined
          : await store.read(image.objectKey!, controller.signal);
      const object = download ?? (await store.head(image.objectKey!));
      if (object.type !== 'image/png' || object.size !== image.sizeBytes) {
        download?.body.destroy();
        throw new HttpError(
          503,
          'DEPENDENCY_UNAVAILABLE',
          'The stored image could not be verified.',
          true,
        );
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', object.size);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      if (req.path.endsWith('/download')) {
        const filename =
          (image.title ?? 'Screenshot')
            .replace(/[/\\]/g, '')
            .replace(/\p{Cc}/gu, '')
            .slice(0, 180) + '.png';
        const encoded = encodeURIComponent(filename).replace(
          /['()*]/g,
          (character) => `%${character.charCodeAt(0).toString(16)}`,
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="screenshot.png"; filename*=UTF-8''${encoded}`,
        );
      }
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      if (download) {
        try {
          await pipeline(download.body, res, { signal: controller.signal });
        } catch {
          if (!res.destroyed) res.destroy();
        }
      }
    },
  );
  return router;
}
