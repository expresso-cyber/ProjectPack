import fs from 'node:fs';
import path from 'node:path';
import type { JobRecord } from '@projectpack/shared';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { env } from '../config/env.js';
import { store } from './store.js';
import { runEngine } from './pythonBridge.js';
import { jobManager } from '../jobs/jobManager.js';
import { runScanNow } from './scanService.js';
import { AppError } from '../utils/errors.js';

// Honor a corporate/network proxy for GitHub API access when configured
// (Node's global fetch ignores HTTP(S)_PROXY environment variables).
const proxyUrl =
  process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([A-Za-z0-9_.\-/]+?))?\/?$/;

export function parseRepoUrl(url: string): RepoRef {
  const match = GITHUB_URL.exec(url.trim());
  if (!match) {
    throw new AppError('GITHUB_ERROR', 'Expected a GitHub repository URL like https://github.com/owner/repo', 400);
  }
  return { owner: match[1], repo: match[2], branch: match[3] || 'HEAD' };
}

interface TarballDownload {
  ok: boolean;
  status: number;
  bytes: number;
}

async function downloadTarball(ref: RepoRef, archivePath: string): Promise<void> {
  const url = `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/refs/heads/${ref.branch === 'HEAD' ? 'main' : ref.branch}`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    // try master as a fallback for HEAD requests
    if (ref.branch === 'HEAD') {
      const fallback = await fetch(`https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/refs/heads/master`);
      if (fallback.ok && fallback.body) {
        const buffer = Buffer.from(await fallback.arrayBuffer());
        fs.writeFileSync(archivePath, buffer);
        return;
      }
    }
    throw new AppError('GITHUB_ERROR', `Could not download repository archive (HTTP ${response.status})`, 502);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(archivePath, buffer);
}

/** Import + scan a public GitHub repository into a new project. */
export async function analyzeRepository(url: string, name?: string): Promise<{ projectId: string; job: JobRecord }> {
  const ref = parseRepoUrl(url);

  // Resolve default branch so the source label is meaningful.
  let defaultBranch = ref.branch;
  if (ref.branch === 'HEAD') {
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (env.githubToken) headers.Authorization = `Bearer ${env.githubToken}`;
      const meta = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, { headers });
      if (meta.ok) {
        defaultBranch = ((await meta.json()) as { default_branch?: string }).default_branch ?? 'main';
      }
    } catch {
      defaultBranch = 'main';
    }
  }

  const project = store.createProject({
    name: name || `${ref.owner}/${ref.repo}`,
    sourceType: 'github',
    sourceLabel: `github.com/${ref.owner}/${ref.repo} (${defaultBranch})`,
    rootPath: '', // filled by the job below
  });

  const job = jobManager.start(project.id, 'github-import', async ({ report }) => {
    report(1, 3);
    const archivePath = path.join(store.tmpDir(), `${project.id}.tar.gz`);
    await downloadTarball({ ...ref, branch: defaultBranch }, archivePath);
    report(2, 3);
    // Keep the unpacked tree under the project's own data directory so that
    // deleting the project removes the downloaded copy as well.
    const dest = path.join(env.dataDir, 'projects', project.id, 'source');
    await runEngine<{ ok: boolean }>('unpack', { archive: archivePath, dest });
    fs.rmSync(archivePath, { force: true });
    report(3, 3);

    // tarballs contain a single <repo>-<sha>/ root directory
    const entries = fs.readdirSync(dest);
    const rootDir = entries.length === 1 && fs.statSync(path.join(dest, entries[0])).isDirectory()
      ? path.join(dest, entries[0])
      : dest;
    store.updateProject(project.id, { rootPath: rootDir });

    // Reuse the local scan pipeline over the unpacked tree.
    await runScanNow(project.id);
    return { imported: true, rootDir };
  });

  return { projectId: project.id, job };
}

/** Repository tree without downloading the whole archive. */
export async function repositoryTree(url: string): Promise<{
  repo: string;
  defaultBranch: string;
  entries: { path: string; type: 'blob' | 'tree'; size?: number }[];
  truncated: boolean;
}> {
  const ref = parseRepoUrl(url);
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (env.githubToken) headers.Authorization = `Bearer ${env.githubToken}`;
  const response = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${ref.branch}?recursive=1`,
    { headers },
  );
  if (!response.ok) {
    throw new AppError('GITHUB_ERROR', `GitHub API returned HTTP ${response.status}`, 502);
  }
  const payload = (await response.json()) as {
    tree: { path: string; type: 'blob' | 'tree'; size?: number }[];
    truncated: boolean;
  };
  return {
    repo: `${ref.owner}/${ref.repo}`,
    defaultBranch: ref.branch,
    entries: payload.tree.map((t) => ({ path: t.path, type: t.type, size: t.size })),
    truncated: payload.truncated,
  };
}
