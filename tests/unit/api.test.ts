import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnvironment } from '../../apps/api/src/config/environment.js';
import { errorHandler } from '../../apps/api/src/middleware/errors.js';

describe('API infrastructure', () => {
  const app = createApp(parseEnvironment({}));
  it('serves health and GET/HEAD without dependencies', async () => {
    const result = await request(app).get('/api/health');
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect((await request(app).head('/api/health')).text).toBeUndefined();
  });
  it('returns readiness unavailable without credentials', async () => {
    const result = await request(app).get('/api/ready');
    expect(result.status).toBe(503);
    expect(result.body.dependencies.database).toBe('unavailable');
  });
  it('returns structured JSON 404 and validates JSON/parser size', async () => {
    expect((await request(app).get('/api/missing')).body.error.code).toBe(
      'NOT_FOUND',
    );
    const malformed = await request(app)
      .post('/api/missing')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_INPUT');
    const large = await request(app)
      .post('/api/missing')
      .send({ text: 'a'.repeat(1024 * 1024) });
    expect(large.status).toBe(413);
  });
  it('rejects foreign browser mutation origins', async () => {
    const result = await request(app)
      .post('/api/missing')
      .set('Origin', 'https://foreign.example')
      .send({});
    expect(result.status).toBe(403);
  });
  it('never exposes unexpected errors, raw request body or secrets', async () => {
    const failing = express();
    failing.get('/fail', () => {
      throw new Error('private password and SQL');
    });
    failing.use(errorHandler);
    const result = await request(failing).get('/fail');
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('password');
  });
});
