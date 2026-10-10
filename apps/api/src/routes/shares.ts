import { Router } from 'express';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import {
  idSchema,
  meSchema,
  shareInputSchema,
  shareTokenSchema,
} from '@screenstash/shared';
import type { Database } from '@screenstash/db';
import type { ObjectStore } from '../storage/r2.js';
import type { Environment } from '../config/environment.js';
import { ShareService } from '../modules/shares.js';
import { HttpError } from '../middleware/errors.js';
import { throttle } from '../modules/policy.js';

export function shareRoutes(
  environment: Environment,
  database?: Database,
  store?: ObjectStore,
) {
  const router = Router();
  router.use(
    ['/api/public/shares/:token', '/s/:token/image', '/s/:token/preview.jpg'],
    async (req, _res, next) => {
      if (!shareTokenSchema.safeParse(req.params.token).success)
        throw new HttpError(
          404,
          'NOT_FOUND',
          'This shared screenshot is unavailable.',
        );
      if (database) {
        await throttle(database, 'public:global', 6000);
        await throttle(
          database,
          `public:${createHash('sha256').update(String(req.params.token)).digest('hex')}`,
          300,
        );
      }
      next();
    },
  );
  const service = () => {
    if (!database || !store)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Sharing services are unavailable.',
        true,
      );
    return new ShareService(database, store, environment);
  };
  router.get('/api/screenshots/:id/share', async (req, res) =>
    res.json(
      await service().status(
        meSchema.parse(res.locals.owner).id,
        idSchema.parse(req.params.id),
      ),
    ),
  );
  router.post('/api/screenshots/:id/share', async (req, res) => {
    const input = shareInputSchema.parse(req.body);
    res.json(
      await service().create(
        meSchema.parse(res.locals.owner).id,
        idSchema.parse(req.params.id),
        input.publicTitle,
        input.replaceActive,
      ),
    );
  });
  router.delete('/api/screenshots/:id/share', async (req, res) => {
    await service().revoke(
      meSchema.parse(res.locals.owner).id,
      idSchema.parse(req.params.id),
    );
    res.status(204).end();
  });
  router.get('/api/public/shares/:token', async (req, res) =>
    res.json(await service().publicDetails(String(req.params.token))),
  );
  router.get(['/s/:token/image', '/s/:token/preview.jpg'], async (req, res) => {
    const token = String(req.params.token);
    const { image, share } = await service().resolve(token);
    if (!store)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Sharing services are unavailable.',
        true,
      );
    const preview = req.path.endsWith('/preview.jpg'),
      key = preview ? share.previewObjectKey : image.objectKey!;
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    let download: Awaited<ReturnType<ObjectStore['read']>> | undefined;
    try {
      if (req.method !== 'HEAD')
        download = await store.read(key, controller.signal);
    } catch (error) {
      if (error instanceof HttpError && error.code === 'UPLOAD_NOT_READY')
        throw new HttpError(
          404,
          'NOT_FOUND',
          'This shared screenshot is unavailable.',
        );
      throw error;
    }
    const object = download ?? (await store.head(key));
    if (
      object.type !== (preview ? 'image/jpeg' : 'image/png') ||
      (!preview && object.size !== image.sizeBytes)
    ) {
      download?.body.destroy();
      throw new HttpError(
        404,
        'NOT_FOUND',
        'This shared screenshot is unavailable.',
      );
    }
    res.setHeader('Content-Type', object.type);
    res.setHeader('Content-Length', object.size);
    res.setHeader(
      'Content-Disposition',
      preview
        ? 'inline; filename="preview.jpg"'
        : 'inline; filename="screenshot.png"',
    );
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (!download) {
      res.end();
      return;
    }
    try {
      await pipeline(download.body, res, { signal: controller.signal });
    } catch {
      if (!res.destroyed) res.destroy();
    }
  });
  return router;
}
