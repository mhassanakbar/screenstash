import express from 'express';
import { healthResponseSchema } from '@screenstash/shared';

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.get('/api/health', (_req, res) => {
  res.json(
    healthResponseSchema.parse({ status: 'ok', service: 'screenstash-api' }),
  );
});
app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

export default app;
