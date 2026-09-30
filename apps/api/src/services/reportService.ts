import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { ReportResponse } from '@projectpack/shared';
import { store } from './store.js';
import { runEngine, runEngineExport } from './pythonBridge.js';

/** Combined TXT/Markdown/JSON export of extracted content.
 *
 *  Selective export: `extension` filters by file type (e.g. ".py"),
 *  `pathPrefix` by folder, and `limit` caps the number of files included
 *  (largest-first). This keeps exports within AI context budgets.
 */
export async function createExport(
  projectId: string,
  format: 'txt' | 'md' | 'json',
  filters: { extension?: string; pathPrefix?: string; limit?: number } = {},
): Promise<{ downloadUrl: string; bytes: number; fileCount: number }> {
  const project = store.requireProject(projectId);
  let files = store.getFiles(projectId).filter((f) => f.extractionStatus === 'extracted');
  if (filters.extension) {
    files = files.filter((f) => f.extension === filters.extension!.toLowerCase());
  }
  if (filters.pathPrefix) {
    files = files.filter((f) =>
      f.relativePath.toLowerCase().includes(filters.pathPrefix!.toLowerCase()),
    );
  }
  if (filters.limit !== undefined && filters.limit > 0) {
    // largest files first — the user gets the most content per file
    files = [...files].sort((a, b) => b.size - a.size).slice(0, filters.limit);
  }
  if (files.length === 0) {
    return { downloadUrl: '', bytes: 0, fileCount: 0 };
  }
  const entries = files.map((f) => ({
    relativePath: f.relativePath,
    text: store.getContent(projectId, f.id) ?? '',
  }));
  const exportId = `exp_${crypto.randomUUID().slice(0, 8)}`;
  const outPath = path.join(store.exportsDir(projectId), `${exportId}.${format === 'md' ? 'md' : format === 'json' ? 'json' : 'txt'}`);
  const { bytes } = await runEngineExport({ entries, format, name: project.name, outPath });
  return { downloadUrl: `/api/projects/${projectId}/exports/${path.basename(outPath)}`, bytes, fileCount: files.length };
}

export function getExportFile(projectId: string, fileName: string): string | null {
  const safe = path.basename(fileName); // reject traversal
  const file = path.join(store.exportsDir(projectId), safe);
  return fs.existsSync(file) ? file : null;
}

/** Report: served from stored analysis; computed on demand if missing. */
export async function getReport(projectId: string): Promise<ReportResponse> {
  store.requireProject(projectId);
  const stored = store.getReport(projectId);
  if (stored) return stored as unknown as ReportResponse;
  return refreshReport(projectId);
}

export async function refreshReport(projectId: string): Promise<ReportResponse> {
  const project = store.requireProject(projectId);
  const files = store.getFiles(projectId);
  const folders = store.getFolders(projectId);
  const result = await runEngine<{ report: ReportResponse }>('analyze', {
    source: project.rootPath,
    files: files.map((f) => ({ ...f, fileId: f.id })),
    folders,
  });
  store.saveReport(projectId, result.report);
  return result.report;
}
