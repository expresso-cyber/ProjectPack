import fs from 'node:fs';
import type { FileRecord, JobRecord, DuplicateGroup } from '@projectpack/shared';
import { env } from '../config/env.js';
import { store, fileIdFor } from './store.js';
import { runEngine } from './pythonBridge.js';
import { jobManager } from '../jobs/jobManager.js';
import { AppError } from '../utils/errors.js';

interface ScanFile {
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
  isBinary: boolean | null;
  isSupported: boolean | null;
  hash?: string | null;
  warnings?: string[];
}

interface ScanOutput {
  root: string;
  scannedAt: string;
  totalSize: number;
  warnings: string[];
  skipped: { path: string; reason: string }[];
  files: ScanFile[];
  folders: {
    name: string;
    relativePath: string;
    depth: number;
    childFolderCount: number;
    childFileCount: number;
  }[];
}

/**
 * Scan work (discover + metadata + hash). Shared by the background and the
 * awaited variants below — and by the website import job, which runs it
 * inline so its progress feeds the import job's progress bar.
 */
export async function scanWork(
  projectId: string,
  report: (completed: number, total: number, failed?: number, detail?: string) => void,
  opts: { knownHashes?: Map<string, string> } = {},
): Promise<Record<string, unknown>> {
  const project = store.requireProject(projectId);
  {
    const scan = await runEngine<ScanOutput>('scan', {
      source: project.rootPath,
      maxFiles: 20000,
      exclude: project.excludeDirs ?? [],
    });

      report(0, scan.files.length);

      // Content hashing (duplicate detection input) — parallel engine batches.
      // Hashes already computed while a file was downloaded (website import)
      // are reused, so only new/changed files are read off disk again.
      const known = opts.knownHashes;
      const hashInput = scan.files
        .map((f) => f.relativePath)
        .filter((p) => !known?.has(p));
      const hashBatches = chunk(hashInput, 500);
      const hashes = new Map<string, string>();
      if (known) for (const [p, h] of known) hashes.set(p, h);
      let hashCursor = 0;
      let hashed = 0;
      const hashWorker = async (): Promise<void> => {
        while (hashCursor < hashBatches.length) {
          const batch = hashBatches[hashCursor];
          hashCursor += 1;
          const results = await runEngine<{ relativePath: string; hash?: string; error?: string }[]>('hash', {
            source: project.rootPath,
            files: batch,
          });
          for (const r of results) if (r.hash) hashes.set(r.relativePath, r.hash);
          hashed += batch.length;
          report(hashed, hashInput.length, undefined, `Hashing files — ${hashed}/${hashInput.length}`);
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(Math.max(1, env.hashConcurrency), 4) },
          () => hashWorker(),
        ),
      );

      // Preserve extraction state across rescans: if a file's content hash is
      // unchanged and its extracted text is already stored, keep it "extracted"
      // instead of resetting everything to pending (the export panel and
      // prompts stay available after a rescan).
      const previous = new Map(store.getFiles(projectId).map((f) => [f.id, f]));
      const files: FileRecord[] = scan.files.map((f) => {
        const id = fileIdFor(projectId, f.relativePath);
        const hash = hashes.get(f.relativePath);
        const prior = previous.get(id);
        if (
          prior &&
          prior.extractionStatus === 'extracted' &&
          hash &&
          prior.hash === hash &&
          store.getContent(projectId, id) !== null
        ) {
          return {
            id,
            projectId,
            name: f.name,
            relativePath: f.relativePath,
            extension: f.extension,
            size: f.size,
            modifiedAt: f.modifiedAt,
            hash,
            isSupported: f.isSupported ?? false,
            isBinary: f.isBinary ?? true,
            extractionStatus: 'extracted' as const,
            contentPreview: prior.contentPreview,
            pageCount: prior.pageCount,
            sheetCount: prior.sheetCount,
            slideCount: prior.slideCount,
          };
        }
        return {
          id,
          projectId,
          name: f.name,
          relativePath: f.relativePath,
          extension: f.extension,
          size: f.size,
          modifiedAt: f.modifiedAt,
          hash,
          isSupported: f.isSupported ?? false,
          isBinary: f.isBinary ?? true,
          extractionStatus: 'pending' as const,
          contentPreview: undefined,
        };
      });
      store.saveFiles(projectId, files);
      store.saveFolders(projectId, scan.folders);

      store.updateProject(projectId, {
        status: 'ready',
        fileCount: files.length,
        folderCount: scan.folders.length,
        totalSize: scan.totalSize,
      });

    return {
      fileCount: files.length,
      folderCount: scan.folders.length,
      totalSize: scan.totalSize,
      skipped: scan.skipped.length,
      warnings: scan.warnings,
    };
  }
}

/** Start a scan in the background; the client polls /api/jobs/:jobId. */
export function startScan(projectId: string): JobRecord {
  store.requireProject(projectId);
  store.updateProject(projectId, { status: 'scanning' });
  return jobManager.start(projectId, 'scan', async ({ report }) => {
    try {
      return await scanWork(projectId, report);
    } catch (err) {
      store.updateProject(projectId, { status: 'error' });
      if (err instanceof AppError) {
        // Surface engine errors as a job failure with the engine's message.
        throw new AppError('INVALID_PROJECT_SOURCE', err.message, 400);
      }
      throw err;
    }
  });
}

/** Awaited scan — used by the GitHub import flow (which nests a scan job). */
export async function runScanNow(projectId: string): Promise<void> {
  store.updateProject(projectId, { status: 'scanning' });
  try {
    await jobManager.run(projectId, 'scan', ({ report }) => scanWork(projectId, report));
  } catch (err) {
    store.updateProject(projectId, { status: 'error' });
    throw err;
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function getTree(projectId: string): Record<string, unknown> {
  const files = store.getFiles(projectId);
  const folders = store.getFolders(projectId) as {
    name: string;
    relativePath: string;
    depth: number;
    childFolderCount: number;
    childFileCount: number;
  }[];
  const root = {
    id: 'root',
    name: '/',
    relativePath: '',
    depth: 0,
    folders: [] as unknown[],
    files: [] as unknown[], // populated by the single files loop below
  };
  const nodeByPath = new Map<string, { folders: unknown[]; files: unknown[] }>(
    folders.map((f) => [f.relativePath, { folders: [], files: [] }]),
  );
  nodeByPath.set('', root as never);
  for (const folder of [...folders].sort((a, b) => a.depth - b.depth)) {
    const node = nodeByPath.get(folder.relativePath)!;
    const parentRel = folder.relativePath.includes('/')
      ? folder.relativePath.slice(0, folder.relativePath.lastIndexOf('/'))
      : '';
    const parent = nodeByPath.get(parentRel);
    if (parent) {
      parent.folders.push({
        id: `d_${folder.relativePath}`,
        name: folder.name,
        relativePath: folder.relativePath,
        depth: folder.depth,
        folders: node.folders,
        files: node.files,
      });
    }
  }
  for (const file of files) {
    const parentRel = file.relativePath.includes('/')
      ? file.relativePath.slice(0, file.relativePath.lastIndexOf('/'))
      : '';
    const parent = nodeByPath.get(parentRel);
    if (parent) parent.files.push(file);
  }
  return { projectId, root };
}

/** Duplicate analysis work over the stored (already-hashed) file records. */
async function duplicatesWork(projectId: string): Promise<DuplicateGroup[]> {
  const project = store.requireProject(projectId);
  const files = store.getFiles(projectId);
  if (files.length === 0) throw new AppError('INVALID_PROJECT_SOURCE', 'Project has no scan results yet', 409);
  const result = await runEngine<{ duplicates: DuplicateGroup[] }>('analyze', {
    source: project.rootPath,
    files: files.map((f) => ({ ...f, fileId: f.id })),
    folders: store.getFolders(projectId),
  });
  store.saveDuplicates(projectId, result.duplicates);
  return result.duplicates;
}

/** Start duplicate analysis in the background; the client polls the job. */
export function startDuplicates(projectId: string): JobRecord {
  store.requireProject(projectId);
  return jobManager.start(projectId, 'duplicates', async ({ report }) => {
    report(1, 2);
    const groups = await duplicatesWork(projectId);
    report(2, 2);
    return { groups: groups.length };
  });
}
