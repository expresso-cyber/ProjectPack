import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { unzipSync } from 'fflate';
import {
  browserDuplicates,
  deleteBrowserProject,
  extensionForContentType,
  folderCount,
  importLocalFolder,
  importWebsite,
  listBrowserFiles,
  listBrowserProjects,
  parseGithubUrl,
  pathForUrl,
  refsFromHtml,
  saveBrowserProject,
  searchBrowserFiles,
  sha256Hex,
  urlsInCss,
} from '../src/lib/browser';
import type { DirHandleLike, FileHandleLike } from '../src/lib/browser';
import { zipBlobs } from '../src/lib/browser/zip';
import { blobToArrayBuffer } from '../src/lib/browser/blob';

const encoder = new TextEncoder();

function blobOf(text: string, type = 'text/plain'): Blob {
  return new Blob([text], { type });
}

describe('browser mode: hashing', () => {
  it('matches the known SHA-256 vector', async () => {
    expect(await sha256Hex(blobOf('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable for identical content (that is what duplicate detection uses)', async () => {
    expect(await sha256Hex(blobOf('same'))).toBe(await sha256Hex(blobOf('same')));
    expect(await sha256Hex(blobOf('a'))).not.toBe(await sha256Hex(blobOf('b')));
  });
});

describe('browser mode: local storage', () => {
  it('stores projects and files, then deletes both together', async () => {
    const project = await saveBrowserProject({
      name: 'unit-test-project',
      sourceType: 'folder',
      sourceLabel: 'Local folder: unit',
      result: {
        truncated: false,
        skippedMedia: 0,
        files: [
          { relativePath: 'index.html', blob: blobOf('<h1>hi</h1>', 'text/html'), size: 11, hash: 'h1', text: '<h1>hi</h1>' },
          { relativePath: 'css/app.css', blob: blobOf('body{}', 'text/css'), size: 6, hash: 'h2', text: 'body{}' },
        ],
      },
    });

    const projects = await listBrowserProjects();
    expect(projects.some((p) => p.id === project.id)).toBe(true);
    expect(project.fileCount).toBe(2);

    const files = await listBrowserFiles(project.id);
    expect(files.map((f) => f.relativePath)).toEqual(['css/app.css', 'index.html']);
    expect(files[1].text).toContain('hi');

    await deleteBrowserProject(project.id);
    expect((await listBrowserProjects()).some((p) => p.id === project.id)).toBe(false);
    expect(await listBrowserFiles(project.id)).toHaveLength(0);
  });
});

describe('browser mode: helpers', () => {
  it('groups duplicates by hash and searches name, path and text', () => {
    const base = { projectId: 'p', extension: '.png', blob: blobOf('x'), text: undefined } as const;
    const files = [
      { ...base, id: '1', relativePath: 'a/logo.png', name: 'logo.png', size: 10, hash: 'same' },
      { ...base, id: '2', relativePath: 'b/logo.png', name: 'logo.png', size: 10, hash: 'same' },
      { ...base, id: '3', relativePath: 'a/other.png', name: 'other.png', size: 5, hash: 'different' },
    ] as never[];
    expect(browserDuplicates(files)).toHaveLength(1);
    expect(browserDuplicates(files)[0].files).toHaveLength(2);
    expect(searchBrowserFiles(files, 'other').map((f) => f.id)).toEqual(['3']);
    expect(folderCount(files)).toBe(2);
  });

  it('parses GitHub URLs in the shapes people paste', () => {
    expect(parseGithubUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo', branch: undefined });
    expect(parseGithubUrl('github.com/owner/repo.git')).toMatchObject({ owner: 'owner', repo: 'repo' });
    expect(parseGithubUrl('https://github.com/owner/repo/tree/dev')).toMatchObject({ branch: 'dev' });
    expect(() => parseGithubUrl('https://example.com/x')).toThrow();
  });

  it('maps URLs onto mirror paths with sensible extensions', () => {
    expect(pathForUrl(new URL('https://www.example.com/'))).toBe('example.com/index.html');
    expect(pathForUrl(new URL('https://example.com/about'))).toBe('example.com/about.html');
    expect(pathForUrl(new URL('https://example.com/img/logo.png'))).toBe('example.com/img/logo.png');
    expect(pathForUrl(new URL('https://cdn.example.com/style.css'))).toBe('cdn.example.com/style.css');
    expect(extensionForContentType('text/css; charset=utf-8')).toBe('.css');
  });

  it('finds CSS url() and @import references', () => {
    const refs = urlsInCss(
      'body{background:url("/img/bg.png")} @import "extra.css"; a{background:url(data:image/png;base64,xx)}',
      new URL('https://example.com/css/main.css'),
    );
    expect(refs.map((u) => u.toString())).toEqual([
      'https://example.com/img/bg.png',
      'https://example.com/css/extra.css',
    ]);
  });
});

describe('browser mode: HTML reference discovery', () => {
  it('collects pages, assets, srcset, lazy attributes and inline CSS', () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="/style.css">
      <script src="/app.js"></script>
      <style>body{background:url('/inline.png')}</style>
      </head><body>
      <a href="/about">About</a>
      <a href="https://other.com/x">External</a>
      <img src="/img/logo.png" alt="logo">
      <img data-src="/img/lazy.png">
      <img srcset="/img/hero.png 1x, /img/hero2.png 2x">
      <video><source src="/media/clip.mp4"></video>
      </body></html>`;
    const { pages, assets } = refsFromHtml(html, new URL('https://example.com/'));
    const pageUrls = pages.map((u) => u.pathname);
    const assetUrls = assets.map((u) => u.pathname);

    expect(pageUrls).toContain('/about');
    expect(pageUrls).toContain('/x'); // external page — the crawler filters host later
    expect(assetUrls).toContain('/style.css');
    expect(assetUrls).toContain('/app.js');
    expect(assetUrls).toContain('/img/logo.png');
    expect(assetUrls).toContain('/img/lazy.png');
    expect(assetUrls).toContain('/img/hero2.png');
    expect(assetUrls).toContain('/media/clip.mp4');
    expect(assetUrls).toContain('/inline.png');
  });
});

describe('browser mode: local folder walking', () => {
  function fileHandle(name: string, content: string): FileHandleLike {
    return { kind: 'file', name, getFile: async () => new File([content], name) };
  }
  function dirHandle(name: string, children: (DirHandleLike | FileHandleLike)[]): DirHandleLike {
    return {
      kind: 'directory',
      name,
      values: async function* () {
        for (const child of children) yield child;
      },
    };
  }

  it('walks the tree, skips ignored folders and honours the media toggle', async () => {
    const root = dirHandle('project', [
      fileHandle('index.html', '<h1>hi</h1>'),
      dirHandle('src', [fileHandle('app.js', 'console.log(1)')]),
      dirHandle('node_modules', [fileHandle('junk.js', 'junk')]),
      fileHandle('clip.mp4', 'fake-video-bytes'),
    ]);

    const withMedia = await importLocalFolder(root, () => undefined, false);
    expect(withMedia.files.map((f) => f.relativePath).sort()).toEqual([
      'clip.mp4',
      'index.html',
      'src/app.js',
    ]);

    const withoutMedia = await importLocalFolder(root, () => undefined, true);
    expect(withoutMedia.files.map((f) => f.relativePath).sort()).toEqual(['index.html', 'src/app.js']);
    expect(withoutMedia.skippedMedia).toBe(1);
    // text-like files carry their content for offline search
    expect(withoutMedia.files.find((f) => f.relativePath === 'index.html')?.text).toContain('hi');
  });
});

describe('browser mode: website import through a proxy', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const target = decodeURIComponent(String(input).split('u=')[1] ?? '');
      if (target === 'https://site.test/') {
        return new Response(
          '<html><head><link rel="stylesheet" href="/style.css"></head><body><img src="/img/logo.png"><a href="/about.html">About</a></body></html>',
          { headers: { 'content-type': 'text/html' } },
        );
      }
      if (target === 'https://site.test/about.html') {
        return new Response('<html><body>About page</body></html>', {
          headers: { 'content-type': 'text/html' },
        });
      }
      if (target === 'https://site.test/style.css') {
        return new Response('body{background:url("/img/bg.png")}', { headers: { 'content-type': 'text/css' } });
      }
      if (target === 'https://site.test/img/logo.png') {
        return new Response(encoder.encode('PNG'), { headers: { 'content-type': 'image/png' } });
      }
      if (target === 'https://site.test/img/bg.png') {
        return new Response(encoder.encode('PNG'), { headers: { 'content-type': 'image/png' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('crawls pages, follows CSS references and stores everything locally', async () => {
    const result = await importWebsite('https://site.test/', () => undefined, {
      proxyTemplate: 'https://proxy.test/?u={url}',
      maxPages: 5,
      maxAssets: 20,
    });
    const paths = result.files.map((f) => f.relativePath).sort();
    expect(paths).toContain('site.test/index.html');
    expect(paths).toContain('site.test/about.html');
    expect(paths).toContain('site.test/style.css');
    expect(paths).toContain('site.test/img/logo.png');
    expect(paths).toContain('site.test/img/bg.png'); // discovered inside the CSS
    expect(result.files.every((f) => f.hash.length === 64)).toBe(true);
  });

  it('fails with a clear message when the proxy returns nothing', async () => {
    await expect(
      importWebsite('https://site.test/missing', () => undefined, { proxyTemplate: 'https://proxy.test/?u={url}' }),
    ).rejects.toThrow(/Nothing could be fetched through the proxy/);
  });
});

describe('browser mode: zip download', () => {
  it('produces a readable archive with every path', async () => {
    const blob = await zipBlobs([
      { path: 'site.test/index.html', blob: blobOf('<h1>hi</h1>', 'text/html') },
      { path: 'site.test/css/app.css', blob: blobOf('body{}', 'text/css') },
    ]);
    const entries = unzipSync(new Uint8Array(await blobToArrayBuffer(blob)));
    expect(Object.keys(entries).sort()).toEqual(['site.test/css/app.css', 'site.test/index.html']);
    expect(new TextDecoder().decode(entries['site.test/index.html'])).toContain('hi');
  });
});
