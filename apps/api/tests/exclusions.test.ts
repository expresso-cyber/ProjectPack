import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { TEST } from './setup.js';
import { waitForJob } from './helpers.js';

let app: import('express').Express;

beforeAll(async () => {
  const mod = await import('../src/app.js');
  app = mod.createApp();
});

afterAll(() => {
  fs.rmSync(TEST.dataDir, { recursive: true, force: true });
});

describe('configurable scan exclusions', () => {
  it('skips custom-excluded directories during scan', async () => {
    const extraDir = path.join(TEST.fixtureDir, 'excluded-dir');
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, 'skipme.py'), 'print("skip")\n');

    const create = await request(app)
      .post('/api/projects')
      .send({ name: 'Excl', rootPath: TEST.fixtureDir });
    const id = create.body.id;

    const scan = await request(app)
      .post(`/api/projects/${id}/scan`)
      .send({ exclude: ['excluded-dir', 'session02'] });
    expect(scan.status).toBe(202);
    expect((await waitForJob(app, scan.body.jobId)).status).toBe('completed');

    const files = await request(app).get(`/api/projects/${id}/files`);
    const paths = files.body.files.map((f: { relativePath: string }) => f.relativePath);
    expect(paths.some((p: string) => p.startsWith('excluded-dir'))).toBe(false);
    expect(paths.some((p: string) => p.startsWith('session02'))).toBe(false);
    expect(paths).toContain('session01/s01.py');
  });
});
