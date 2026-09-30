import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { TEST } from './setup.js';

let app: import('express').Express;

beforeAll(async () => {
  const mod = await import('../src/app.js');
  app = mod.createApp();
});

afterAll(() => {
  fs.rmSync(TEST.dataDir, { recursive: true, force: true });
});

describe('health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('projects', () => {
  it('rejects a missing rootPath with the documented error format', async () => {
    const res = await request(app).post('/api/projects').send({ name: 'x', rootPath: '/definitely/not/here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'INVALID_PROJECT_SOURCE' });
  });

  it('creates a local project', async () => {
    const res = await request(app).post('/api/projects').send({ name: 'Fixture', rootPath: TEST.fixtureDir });
    expect(res.status).toBe(201);
    expect(res.body.sourceType).toBe('local');
    expect(res.body.rootPath).toBeUndefined(); // internal path is never exposed
  });

  it('lists projects', async () => {
    const create = await request(app).post('/api/projects').send({ name: 'Fixture2', rootPath: TEST.fixtureDir });
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.some((p: { id: string }) => p.id === create.body.id)).toBe(true);
  });
});

describe('validation & errors', () => {
  it('returns VALIDATION_ERROR for bad bodies', async () => {
    const res = await request(app).post('/api/projects').send({ nope: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND for unknown projects', async () => {
    const res = await request(app).get('/api/projects/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND for unknown routes', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
  });
});

describe('project deletion', () => {
  it('deletes metadata without touching the source', async () => {
    const create = await request(app).post('/api/projects').send({ name: 'Temp', rootPath: TEST.fixtureDir });
    const del = await request(app).delete(`/api/projects/${create.body.id}`);
    expect(del.status).toBe(204);
    expect(fs.existsSync(TEST.fixtureDir)).toBe(true);
    await request(app).get(`/api/projects/${create.body.id}`).expect(404);
  });
});
