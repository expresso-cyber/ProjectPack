import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Response } from 'superagent';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { TEST } from './setup.js';
import { waitForJob } from './helpers.js';

/** Binary response parser for supertest (ZIP / image streams). */
function binaryParser(res: Response, callback: (err: Error | null, body?: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

/**
 * Website import pipeline test: a small fixture site is served on loopback,
 * crawled, scanned, extracted, and checked through images / raw / prompt /
 * AI-status endpoints.
 */

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SVG_STAR = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>',
);

let server: http.Server;
let baseUrl = '';
let flakySeen = false; // /img/flaky.png returns 429 once, then succeeds
let app: import('express').Express;
let projectId = '';

beforeAll(async () => {
  // Fixture site on loopback (the crawler bypasses any proxy for localhost).
  server = http.createServer((req, res) => {
    const send = (status: number, type: string, body: string | Buffer) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      // Validators let a re-import skip unchanged files with a 304.
      const etag = `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
      const lastModified = 'Wed, 01 Oct 2025 10:00:00 GMT';
      if (status === 200 && req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Last-Modified': lastModified });
        res.end();
        return;
      }
      res.writeHead(status, { 'Content-Type': type, ETag: etag, 'Last-Modified': lastModified });
      res.end(buf);
    };
    switch (req.url) {
      case '/':
        send(
          200,
          'text/html',
          `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="/style.css">
    <script src="/app.js"></script>
  </head>
  <body style="background: url('/img/bg.png')">
    <h1>Fixture home</h1>
    <img src="/img/logo.png" alt="Site logo">
    <img srcset="/img/hero.png 1x, /img/hero.png 2x" alt="Hero">
    <img class="lazy" src="/img/logo.png" data-src="/img/lazy.png" alt="Lazy image">
    <img src="/img/flaky.png" alt="Flaky">
    <img src="/img/gone.png" alt="Gone">
    <div data-bg="/img/divbg.png"></div>
    <video controls><source src="/media/clip.mp4" type="video/mp4"></video>
    <a href="/about.html">About</a>
    <a href="/private/secret.html">Secret</a>
  </body>
</html>`,
        );
        break;
      case '/app.js':
        send(200, 'application/javascript', 'const gallery = ["/img/jsref.png"];');
        break;
      case '/media/clip.mp4':
        send(200, 'video/mp4', Buffer.from('00000018667479706d703432fakevideodata'));
        break;
      case '/blocked.html':
        send(403, 'text/html', 'Forbidden');
        break;
      case '/media.html':
        send(
          200,
          'text/html',
          '<!doctype html><html><body><img src="/img/logo.png" alt="Logo"><video controls><source src="/media/clip.mp4" type="video/mp4"></video></body></html>',
        );
        break;
      case '/about.html':
        send(200, 'text/html', '<!doctype html><html><body><p>About fixture page alpha.</p></body></html>');
        break;
      case '/style.css':
        send(200, 'text/css', 'body { background: url("/img/wave.png"); }\n@import "/extra.css";');
        break;
      case '/extra.css':
        send(200, 'text/css', '.star { background: url("/img/star.svg"); }');
        break;
      case '/img/logo.png':
      case '/img/hero.png':
      case '/img/bg.png':
      case '/img/wave.png':
      case '/img/lazy.png':
      case '/img/divbg.png':
      case '/img/jsref.png':
        send(200, 'image/png', PNG_1X1);
        break;
      case '/img/flaky.png':
        if (!flakySeen) {
          flakySeen = true;
          send(429, 'text/plain', 'slow down');
        } else {
          send(200, 'image/png', PNG_1X1);
        }
        break;
      case '/img/gone.png':
        send(404, 'text/plain', 'not found');
        break;
      case '/img/star.svg':
        send(200, 'image/svg+xml', SVG_STAR);
        break;
      case '/robots.txt':
        send(200, 'text/plain', 'User-agent: *\nDisallow: /private/\n');
        break;
      case '/private/secret.html':
        send(200, 'text/html', '<html><body>secret page</body></html>');
        break;
      default:
        send(404, 'text/plain', 'not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const mod = await import('../src/app.js');
  app = mod.createApp();
});

afterAll(() => {
  server.close();
  fs.rmSync(TEST.dataDir, { recursive: true, force: true });
});

describe('website import pipeline', () => {
  it('rejects invalid URLs', async () => {
    const res = await request(app).post('/api/website/analyze').send({ url: 'not a real url' });
    expect(res.status).toBe(400);
  });

  it('crawls the fixture site and runs the full scan pipeline', async () => {
    const start = await request(app).post('/api/website/analyze').send({ url: baseUrl });
    expect(start.status).toBe(202);
    projectId = start.body.projectId;
    expect(projectId).toBeTruthy();

    const job = await waitForJob(app, start.body.jobId);
    expect(job.status).toBe('completed');
    expect(job.type).toBe('website-import');

    const project = await request(app).get(`/api/projects/${projectId}`);
    expect(project.status).toBe(200);
    expect(project.body.sourceType).toBe('website');
    expect(project.body.status).toBe('ready');
    expect(project.body.fileCount).toBeGreaterThanOrEqual(9);

    const files = await request(app).get(`/api/projects/${projectId}/files`);
    const paths: string[] = files.body.files.map((f: { relativePath: string }) => f.relativePath);
    // pages, styles, and images are all mirrored
    expect(paths.some((p) => p.endsWith('index.html'))).toBe(true);
    expect(paths.some((p) => p.endsWith('about.html'))).toBe(true);
    expect(paths.some((p) => p.endsWith('style.css'))).toBe(true);
    expect(paths.some((p) => p.endsWith('extra.css'))).toBe(true);
    expect(paths.some((p) => p.endsWith('app.js'))).toBe(true);
    // robots.txt is respected — the disallowed page is never fetched
    expect(paths.some((p) => p.includes('private'))).toBe(false);
    // images from img tags, srcset, inline style, and CSS url() are all captured
    for (const name of ['logo.png', 'hero.png', 'bg.png', 'wave.png', 'star.svg']) {
      expect(paths.some((p) => p.endsWith(name))).toBe(true);
    }
    // lazy-loaded image (data-src), element background (data-bg),
    // JS-referenced image, and video are captured too
    for (const name of ['lazy.png', 'divbg.png', 'jsref.png', 'clip.mp4']) {
      expect(paths.some((p) => p.endsWith(name))).toBe(true);
    }
    // a 429 (rate limit) is retried with backoff and recovered…
    expect(paths.some((p) => p.endsWith('flaky.png'))).toBe(true);
    // …while a permanently dead URL is recorded as a visible failure
    expect(paths.some((p) => p.endsWith('gone.png'))).toBe(false);
    const failures = ((job.result as { failures?: { url: string; status?: number }[] }).failures ?? []);
    expect(failures.some((f) => f.url.includes('gone.png') && f.status === 404)).toBe(true);
  });

  it('lists images with source URL, alt text and download URLs', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/images`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(6);
    const logo = res.body.images.find((i: { name: string }) => i.name === 'logo.png');
    expect(logo).toBeTruthy();
    expect(logo.sourceUrl).toContain('/img/logo.png');
    expect(logo.alt).toBe('Site logo');
    expect(logo.downloadUrl).toContain(`/api/projects/${projectId}/files/`);
    const lazy = res.body.images.find((i: { name: string }) => i.name === 'lazy.png');
    expect(lazy).toBeTruthy();
    expect(lazy.alt).toBe('Lazy image');
  });

  it('serves raw image bytes with the right content type', async () => {
    const images = (await request(app).get(`/api/projects/${projectId}/images`)).body.images;
    const logo = images.find((i: { name: string }) => i.name === 'logo.png');
    const raw = await request(app).get(logo.downloadUrl);
    expect(raw.status).toBe(200);
    expect(raw.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(raw.body, PNG_1X1)).toBe(0);
  });

  it('streams a ZIP of all images', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/images/export`)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    // ZIP magic bytes
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('enriches image dimensions after extraction', async () => {
    const start = await request(app).post(`/api/projects/${projectId}/extract`);
    expect(start.status).toBe(202);
    const job = await waitForJob(app, start.body.jobId);
    expect(job.status).toBe('completed');

    const images = (await request(app).get(`/api/projects/${projectId}/images`)).body.images;
    const logo = images.find((i: { name: string }) => i.name === 'logo.png');
    expect(logo.width).toBe(1);
    expect(logo.height).toBe(1);
  });

  it('keeps extraction state across a rescan (export panel survives)', async () => {
    // extraction has run in the previous test — rescan and verify statuses survive
    const start = await request(app).post(`/api/projects/${projectId}/scan`).send({});
    expect(start.status).toBe(202);
    const job = await waitForJob(app, start.body.jobId);
    expect(job.status).toBe('completed');

    const project = await request(app).get(`/api/projects/${projectId}`);
    expect(project.body.stats.extractedCount).toBeGreaterThan(0);
    expect(project.body.stats.failedCount).toBe(0);
  });

  it('includes the image manifest and crawled content in the prompt', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/prompt`).send({});
    expect(res.status).toBe(200);
    expect(res.body.prompt).toContain('## Images & visual assets');
    expect(res.body.prompt).toContain('logo.png');
    expect(res.body.prompt).toContain('alt: "Site logo"');
    expect(res.body.prompt).toContain('Fixture home');
    expect(res.body.prompt).toContain('About fixture page alpha.');
    expect(res.body.prompt).toContain('live website mirror');
    expect(res.body.fileCount).toBeGreaterThan(0);
  });

  it('reports AI status and refuses enhancement when unconfigured', async () => {
    const status = await request(app).get('/api/ai/status');
    expect(status.status).toBe(200);
    expect(typeof status.body.configured).toBe('boolean');
    expect(typeof status.body.model).toBe('string');

    const enhance = await request(app)
      .post(`/api/projects/${projectId}/prompt/enhance`)
      .send({ prompt: 'x' });
    if ((await request(app).get('/api/ai/status')).body.configured) {
      expect([200, 502]).toContain(enhance.status);
    } else {
      expect(enhance.status).toBe(503);
    }
  });

  it('skipMedia leaves video/audio out of the mirror (but keeps images)', async () => {
    const res = await request(app)
      .post('/api/website/analyze')
      .send({ url: `${baseUrl}/media.html`, name: 'No media', skipMedia: true });
    expect(res.status).toBe(202);
    const finished = await waitForJob(app, res.body.jobId);
    expect(finished.status).toBe('completed');

    const files = await request(app).get(`/api/projects/${res.body.projectId}/files`);
    const paths = files.body.files.map((f: { relativePath: string }) => f.relativePath);
    expect(paths.some((p: string) => p.endsWith('.mp4'))).toBe(false);
    expect(paths.some((p: string) => p.endsWith('.png'))).toBe(true);
    // skipped media is reported, not silently dropped
    expect((finished.result as { skippedMedia?: number }).skippedMedia ?? 0).toBeGreaterThan(0);
  });

  it('explains a blocked site clearly instead of a cryptic path error', async () => {
    const res = await request(app).post('/api/website/analyze').send({ url: `${baseUrl}/blocked.html` });
    expect(res.status).toBe(202);
    const finished = await waitForJob(app, res.body.jobId);
    expect(finished.status).toBe('failed');
    // the real reason, with the HTTP status…
    expect(finished.error).toContain('Could not download anything');
    expect(finished.error).toContain('403');
    // …and never the confusing engine path message
    expect(finished.error).not.toContain('Source root is not accessible');
  });

  it('re-importing the same site refreshes that project and skips unchanged files (304)', async () => {
    const res = await request(app).post('/api/website/analyze').send({ url: baseUrl });
    expect(res.status).toBe(202);
    // no duplicate project — the original one is refreshed
    expect(res.body.reused).toBe(true);
    expect(res.body.projectId).toBe(projectId);

    const finished = await waitForJob(app, res.body.jobId);
    expect(finished.status).toBe('completed');
    const result = finished.result as { reused?: boolean; unchanged?: number };
    expect(result.reused).toBe(true);
    // the fixture sends ETag, so the second crawl gets 304s instead of re-downloading
    expect(result.unchanged ?? 0).toBeGreaterThan(0);
  });
});
