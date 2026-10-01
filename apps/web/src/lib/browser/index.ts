/**
 * Browser Mode facade: import → store locally → browse/search/download.
 * The API is never called from here.
 */
import {
  deleteProject as dbDeleteProject,
  getFile as dbGetFile,
  getProject as dbGetProject,
  listFiles as dbListFiles,
  listProjects as dbListProjects,
  putFiles,
  putProject,
} from './db';
import { extensionOf, nameOf } from './types';
import type { BrowserFile, BrowserProject, ImportResult } from './types';
import { zipBlobs } from './zip';

export * from './types';
export * from './importers';
export { sha256Hex } from './hash';

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `bp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export async function saveBrowserProject(input: {
  name: string;
  sourceType: BrowserProject['sourceType'];
  sourceLabel: string;
  result: ImportResult;
}): Promise<BrowserProject> {
  const id = newId();
  const project: BrowserProject = {
    id,
    name: input.name,
    sourceType: input.sourceType,
    sourceLabel: input.sourceLabel,
    createdAt: new Date().toISOString(),
    fileCount: input.result.files.length,
    totalSize: input.result.files.reduce((sum, file) => sum + file.size, 0),
  };
  await putProject(project);
  await putFiles(
    input.result.files.map((file) => ({
      id: `${id}:${file.relativePath}`,
      projectId: id,
      relativePath: file.relativePath,
      name: nameOf(file.relativePath),
      extension: extensionOf(file.relativePath),
      size: file.size,
      hash: file.hash,
      blob: file.blob,
      text: file.text,
    })),
  );
  return project;
}

export const listBrowserProjects = dbListProjects;
export const getBrowserProject = dbGetProject;
export const deleteBrowserProject = dbDeleteProject;
export const listBrowserFiles = dbListFiles;
export const getBrowserFile = dbGetFile;

/** Duplicate detection in the browser — grouping by the hashes we computed. */
export function browserDuplicates(files: BrowserFile[]): { hash: string; files: BrowserFile[] }[] {
  const byHash = new Map<string, BrowserFile[]>();
  for (const file of files) {
    const list = byHash.get(file.hash);
    if (list) list.push(file);
    else byHash.set(file.hash, [file]);
  }
  return [...byHash.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([hash, group]) => ({ hash, files: group }))
    .sort((a, b) => b.files[0].size * (b.files.length - 1) - a.files[0].size * (a.files.length - 1));
}

export function searchBrowserFiles(files: BrowserFile[], query: string): BrowserFile[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return files;
  return files.filter(
    (file) =>
      file.relativePath.toLowerCase().includes(needle) ||
      file.name.toLowerCase().includes(needle) ||
      (file.text ? file.text.toLowerCase().includes(needle) : false),
  );
}

export function folderCount(files: BrowserFile[]): number {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.relativePath.split('/');
    parts.pop();
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      folders.add(acc);
    }
  }
  return folders.size;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadProjectZip(
  files: BrowserFile[],
  name: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  const blob = await zipBlobs(
    files.map((file) => ({ path: file.relativePath, blob: file.blob })),
    onProgress,
  );
  downloadBlob(blob, `${name}.zip`);
}
