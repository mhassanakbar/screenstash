import { Router } from 'express';
import {
  idSchema,
  meSchema,
  screenshotQuerySchema,
  screenshotPatchSchema,
  tagInputSchema,
} from '@screenstash/shared';
import type { Database } from '@screenstash/db';
import { HttpError } from '../middleware/errors.js';
import {
  getScreenshot,
  listScreenshots,
  deleteScreenshot,
  updateScreenshot,
  listTags,
  createTag,
} from '../modules/screenshots.js';

export function screenshotRoutes(database?: Database) {
  const router = Router();
  const db = () => {
    if (!database)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'The library is unavailable.',
        true,
      );
    return database;
  };
  router.get('/api/screenshots', async (req, res) => {
    const query = screenshotQuerySchema.parse(req.query);
    res.json(
      await listScreenshots(
        db(),
        meSchema.parse(res.locals.owner).id,
        query.limit,
        query.cursor,
        query,
      ),
    );
  });
  router.patch('/api/screenshots/:id', async (req, res) =>
    res.json(
      await updateScreenshot(
        db(),
        meSchema.parse(res.locals.owner).id,
        idSchema.parse(req.params.id),
        screenshotPatchSchema.parse(req.body),
      ),
    ),
  );
  router.get('/api/tags', async (_req, res) =>
    res.json(await listTags(db(), meSchema.parse(res.locals.owner).id)),
  );
  router.post('/api/tags', async (req, res) =>
    res.json(
      await createTag(
        db(),
        meSchema.parse(res.locals.owner).id,
        tagInputSchema.parse(req.body).name,
      ),
    ),
  );
  router.get('/api/screenshots/:id', async (req, res) =>
    res.json(
      await getScreenshot(
        db(),
        meSchema.parse(res.locals.owner).id,
        idSchema.parse(req.params.id),
      ),
    ),
  );
  router.delete('/api/screenshots/:id', async (req, res) => {
    await deleteScreenshot(
      db(),
      meSchema.parse(res.locals.owner).id,
      idSchema.parse(req.params.id),
    );
    res.status(204).end();
  });
  return router;
}
