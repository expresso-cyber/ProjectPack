import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { TEST } from './setup.js';
import { waitForJob } from './helpers.js';

let app: import('express').Express;
let projectId = '';

beforeAll(async () => {
  const mod = await import('../src/app.js');
  app = mod.createApp();
});

afterAll(() => {
  fs.rmSync(TEST.dataDir, { recursive: true, force: true });
});

describe('ProjectPack packaging', () => {
  it('sets up a scanned project with duplicates', async () => {
    const create = await request(app).post('/api/projects').send({ name: 'Pack', rootPath: TEST.fixtureDir });
    projectId = create.body.id;
    const scan = await request(app).post(`/api/projects/${projectId}/scan`).send({});
    expect(scan.status).toBe(202);
    expect((await waitForJob(app, scan.body.jobId)).status).toBe('completed');
    const dup = await request(app).post(`/api/projects/${projectId}/duplicates`).send({});
    expect(dup.status).toBe(202);
    expect((await waitForJob(app, dup.body.jobId)).status).toBe('completed');
  });

  it('previews the include/exclude plan', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/package/preview`).send({
      excludeUnsupported: true,
      excludeDuplicates: true,
    });
    expect(res.status).toBe(200);
    const excluded = res.body.entries.filter((e: { included: boolean }) => !e.included);
    const reasons = excluded.map((e: { reason: string }) => e.reason);
    expect(reasons).toContain('Unsupported file type');
    expect(reasons.some((r: string) => r.startsWith('Duplicate of'))).toBe(true);
    expect(res.body.includedCount + res.body.excludedCount).toBe(8);
    expect(res.body.includedCount).toBe(5); // 7 supported − 2 duplicate copies
  });

  it('previews a partial clone: only the selected paths are included', async () => {
    const all = await request(app).post(`/api/projects/${projectId}/package/preview`).send({
      excludeUnsupported: true,
      excludeDuplicates: true,
    });
    const includedPaths = (all.body.entries as { path: string; included: boolean }[])
      .filter((e) => e.included)
      .map((e) => e.path);
    const subset = includedPaths.slice(0, 2);

    const res = await request(app)
      .post(`/api/projects/${projectId}/package/preview`)
      .send({ excludeUnsupported: true, excludeDuplicates: true, includePaths: subset });
    expect(res.status).toBe(200);
    expect(res.body.includedCount).toBe(2);
    const notSelected = res.body.entries.filter(
      (e: { included: boolean; reason: string }) => !e.included && e.reason === 'Not selected',
    );
    expect(notSelected.length).toBe(all.body.includedCount - 2);
  });

  it('downloads a single folder from the tree as a ZIP', async () => {
    const tree = await request(app).get(`/api/projects/${projectId}/tree`);
    const folders = tree.body.root.folders as { relativePath: string; files: unknown[] }[];
    const target = folders.find((f) => f.files.length > 0);
    expect(target).toBeTruthy();

    const res = await request(app)
      .get(`/api/projects/${projectId}/folder/download`)
      .responseType('arraybuffer')
      .query({ path: target!.relativePath });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('.zip');
    // ZIP files start with the local-file-header magic bytes "PK\x03\x04"
    expect(Buffer.from(res.body).slice(0, 2).toString()).toBe('PK');

    const missing = await request(app)
      .get(`/api/projects/${projectId}/folder/download`)
      .query({ path: 'nope/does-not-exist' });
    expect(missing.status).toBe(404);
  });

  it('refuses to create a package without explicit confirmation', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/package/create`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a package, manifest, and zip download', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/package/create`).send({
      confirm: true,
      options: { excludeUnsupported: true, excludeDuplicates: false, excludePatterns: [], maxFileBytes: 104857600 },
    });
    expect(res.status).toBe(201);
    expect(res.body.algorithm).toBe('sha256');
    expect(res.body.files).toHaveLength(7); // all supported files

    const packageId = res.body.packageId;
    const manifest = await request(app).get(`/api/projects/${projectId}/package/${packageId}/manifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.body.fileCount).toBe(7);

    const zip = await request(app).get(`/api/projects/${projectId}/package/${packageId}/download`);
    expect(zip.status).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
  });

  it('does not modify source files during packaging', async () => {
    const before = fs.readdirSync(TEST.fixtureDir, { recursive: true }).sort();
    await request(app).post(`/api/projects/${projectId}/package/create`).send({
      confirm: true,
      options: { excludeUnsupported: true, excludeDuplicates: false, excludePatterns: [], maxFileBytes: 104857600 },
    });
    const after = fs.readdirSync(TEST.fixtureDir, { recursive: true }).sort();
    expect(after).toEqual(before);
  });
});
