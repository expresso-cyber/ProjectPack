import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from the compiled module to the monorepo root (robust across
 *  src/, dist/, and test-build layouts). */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'python', 'file_engine', 'worker.py'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export const REPO_ROOT = findRepoRoot(here);
export const API_ROOT = path.join(REPO_ROOT, 'apps', 'api');

function loadDotEnv(): void {
  const candidates = [
    path.join(REPO_ROOT, '.env'),
    path.join(API_ROOT, '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadDotEnv();

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  port: int(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isTest: process.env.NODE_ENV === 'test',
  // All generated data (metadata, extracted text, packages, downloads) lives
  // OUTSIDE the codebase by default so a repository folder never fills up with
  // analysis output. Override with DATA_DIR in .env.
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(os.homedir(), '.projectpack'),
  pythonBin: process.env.PYTHON_BIN ?? 'python3',
  enginePath: process.env.PYTHON_ENGINE_PATH
    ? path.resolve(process.env.PYTHON_ENGINE_PATH)
    : path.join(REPO_ROOT, 'python', 'file_engine'),
  maxFiles: int(process.env.MAX_FILES, 20000),
  maxFileBytes: int(process.env.MAX_FILE_BYTES, 52_428_800),
  githubToken: process.env.GITHUB_TOKEN,
  // Website import limits — the crawler is bounded so a single import can
  // never run away (pages, non-page assets, total bytes, per-request timeout,
  // politeness delay between requests, and how many requests run in parallel).
  websiteMaxPages: int(process.env.WEBSITE_MAX_PAGES, 30),
  websiteMaxAssets: int(process.env.WEBSITE_MAX_ASSETS, 400),
  websiteMaxTotalBytes: int(process.env.WEBSITE_MAX_TOTAL_BYTES, 104_857_600),
  websiteRequestDelayMs: int(process.env.WEBSITE_REQUEST_DELAY_MS, 100),
  websiteTimeoutMs: int(process.env.WEBSITE_TIMEOUT_MS, 20_000),
  websiteConcurrency: int(process.env.WEBSITE_CONCURRENCY, 6),
  // Python-engine phase concurrency. Every concurrent batch spawns its own
  // Python process (tens of MB RSS each), so on small hosts (Render free =
  // 512 MB) a high value gets the whole service OOM-killed. Keep these low
  // and tune per host.
  extractConcurrency: int(process.env.EXTRACT_CONCURRENCY, 2),
  hashConcurrency: int(process.env.HASH_CONCURRENCY, 2),
  // Optional AI prompt enhancement (ADR-007: the core stays deterministic;
  // AI is only used when the user explicitly asks for it and a key is set).
  aiBaseUrl: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
  aiApiKey: process.env.AI_API_KEY,
  aiModel: process.env.AI_MODEL ?? 'gpt-4o-mini',
};
