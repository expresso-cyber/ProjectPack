import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { TEST } from './setup.js';
import { waitForJob } from './helpers.js';

let app: import('express').Express;
let projectId = '';
let pyFileId = '';
let binFileId = '';

beforeAll(async () => {
  const mod = await import('../src/app.js');
  app = mod.createApp();
});

afterAll(() => {
  fs.rmSync(TEST.dataDir, { recursive: true, force: true });
});

describe('scan → files → extract → search → duplicates → report', () => {
  it('scans the fixture project', async () => {
    const create = await request(app).post('/api/projects').send({ name: 'Pipeline', rootPath: TEST.fixtureDir });
    projectId = create.body.id;

    const start = await request(app).post(`/api/projects/${projectId}/scan`).send({});
    expect(start.status).toBe(202);
    expect(['running', 'completed']).toContain(start.body.job.status);
    const job = await waitForJob(app, start.body.jobId);
    expect(job.status).toBe('completed');

    const files = await request(app).get(`/api/projects/${projectId}/files`);
    expect(files.body.total).toBe(8);

    const bin = files.body.files.find((f: { relativePath: string }) => f.relativePath === 'logo.bin');
    expect(bin.isBinary).toBe(true);
    expect(bin.isSupported).toBe(false);
    binFileId = bin.id;

    const py = files.body.files.find((f: { relativePath: string }) => f.relativePath === 'session01/s01.py');
    expect(py.hash).toMatch(/^[a-f0-9]{64}$/);
    pyFileId = py.id;
  });

  it('filters files', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files`)
      .query({ supported: 'true', extension: '.py' });
    expect(res.body.total).toBe(3); // s01, s02, dupe
  });

  it('builds a tree with folders and nested files', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/tree`);
    expect(res.status).toBe(200);
    const session01 = res.body.root.folders.find((f: { name: string }) => f.name === 'session01');
    expect(session01.files).toHaveLength(3); // s01.py, data.csv, dupe.py
    const empty = res.body.root.folders.find((f: { name: string }) => f.name === 'empty');
    expect(empty.files).toHaveLength(0);
    // regression: root-level files must appear exactly once (no double-push)
    const rootNames = res.body.root.files.map((f: { name: string }) => f.name).sort();
    expect(rootNames.filter((n: string) => n === 'README.md')).toHaveLength(1);
    expect(rootNames.filter((n: string) => n === 'bundle.zip')).toHaveLength(1);
  });

  it('extracts supported content', async () => {
    const start = await request(app).post(`/api/projects/${projectId}/extract`).send({});
    expect(start.status).toBe(202);
    const job = await waitForJob(app, start.body.jobId);
    expect(job.status).toBe('completed');
    expect(job.result.extracted).toBeGreaterThan(0);

    const content = await request(app).get(`/api/projects/${projectId}/files/${pyFileId}/content`);
    expect(content.status).toBe(200);
    expect(content.body.text).toContain('alpha hello world');
    expect(content.body.wordCount).toBeGreaterThan(3);
  });

  it('reports pending/failed content for binary files without crashing', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/files/${binFileId}/content`);
    expect(res.status).toBe(200);
    expect(res.body.warnings.length).toBeGreaterThan(0);
  });

  it('searches extracted content with snippets', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/search`)
      .query({ q: 'alpha hello', content: 'true' });
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.hits[0].snippet.length).toBeGreaterThan(0);
  });

  it('searches names and paths by default', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/search`).query({ q: 'config' });
    expect(res.body.total).toBe(1);
    expect(res.body.hits[0].relativePath).toContain('config.json');
  });

  it('detects exact duplicates by hash', async () => {
    const start = await request(app).post(`/api/projects/${projectId}/duplicates`).send({});
    expect(start.status).toBe(202);
    expect((await waitForJob(app, start.body.jobId)).status).toBe('completed');

    const res = await request(app).get(`/api/projects/${projectId}/duplicates`);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].files).toHaveLength(3); // s01.py, s02.py, dupe.py
    expect(res.body.groups[0].hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces a project report', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/report`);
    expect(res.status).toBe(200);
    expect(res.body.totals.files).toBe(8);
    expect(res.body.totals.folders).toBe(3);
    expect(res.body.duplicates.groups).toBe(1);
    expect(res.body.extensionBreakdown.length).toBeGreaterThan(0);
  });

  it('exports combined markdown', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/export`).send({ format: 'md' });
    expect(res.status).toBe(201);
    expect(res.body.downloadUrl).toContain('/exports/');

    const download = await request(app).get(res.body.downloadUrl);
    expect(download.status).toBe(200);
    expect(download.text).toContain('alpha hello world');
  });

  it('exports selectively by extension and limit', async () => {
    const all = await request(app).post(`/api/projects/${projectId}/export`).send({
      format: 'md',
      extension: '.py',
      limit: 2,
    });
    expect(all.status).toBe(201);
    expect(all.body.fileCount).toBe(2);

    const download = await request(app).get(all.body.downloadUrl);
    expect(download.status).toBe(200);
    expect(download.text).toContain('alpha hello world');

    const none = await request(app).post(`/api/projects/${projectId}/export`).send({
      format: 'md',
      extension: '.zzz',
    });
    expect(none.status).toBe(409);
  });

  it('generates a project recreation prompt', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/prompt`).send({
      includeContent: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.prompt).toContain('Project Recreation Prompt');
    expect(res.body.prompt).toContain('session01/s01.py');
    expect(res.body.prompt).toContain('alpha hello world');
    expect(res.body.prompt).toContain('Build instructions');

    const structureOnly = await request(app).post(`/api/projects/${projectId}/prompt`).send({
      includeContent: false,
    });
    expect(structureOnly.status).toBe(200);
    expect(structureOnly.body.prompt).not.toContain('alpha hello world');
    expect(structureOnly.body.prompt).toContain('Directory structure');
  });

  it('inspects zip archives without extracting', async () => {
    const files = await request(app).get(`/api/projects/${projectId}/files`).query({ extension: '.zip' });
    const zipFile = files.body.files[0];
    const res = await request(app).get(`/api/projects/${projectId}/files/${zipFile.id}/archive`);
    expect(res.status).toBe(200);
    const names = res.body.entries.map((e: { name: string }) => e.name);
    expect(names).toContain('one.txt');
    expect(names).toContain('sub/two.txt');
  });

  it('rejects archive inspection for non-zip files', async () => {
    const files = await request(app).get(`/api/projects/${projectId}/files`).query({ extension: '.py' });
    const res = await request(app).get(`/api/projects/${projectId}/files/${files.body.files[0].id}/archive`);
    expect(res.status).toBe(400);
  });
});
