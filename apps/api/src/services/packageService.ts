import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import type { JobRecord, PackageManifest, PackagePreview, PackagePreviewPlanEntry } from '@projectpack/shared';
import { store } from './store.js';
import { runEngine } from './pythonBridge.js';
import { jobManager } from '../jobs/jobManager.js';
import { AppError } from '../utils/errors.js';

export interface PackageOptions {
  excludeUnsupported: boolean;
  excludeDuplicates: boolean;
  excludePatterns: string[];
  maxFileBytes: number;
  /**
   * Partial-clone support: when set, ONLY these relative paths are packaged
   * (the user's checkbox selection on the package page). Empty/undefined = all
   * files that pass the exclusion rules.
   */
  includePaths?: string[];
}

export const DEFAULT_PACKAGE_OPTIONS: PackageOptions = {
  excludeUnsupported: true,
  excludeDuplicates: false,
  excludePatterns: [],
  maxFileBytes: 100 * 1024 * 1024,
};

/**
 * Build the include/exclude plan. Pure function over stored records — this is
 * the preview the user must approve before anything is written (ADR-008).
 */
export function buildPreview(projectId: string, options: PackageOptions): PackagePreview {
  const files = store.getFiles(projectId);
  if (files.length === 0) {
    throw new AppError('INVALID_PROJECT_SOURCE', 'Project has no scan results yet', 409);
  }
  const duplicates = store.getDuplicates(projectId);
  const keep = new Set<string>();
  for (const group of duplicates) {
    const members = group.fileIds.map((id) => files.find((f) => f.id === id)!).filter(Boolean);
    // Keep the newest member of each duplicate group.
    const newest = [...members].sort(
      (a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt),
    )[0];
    if (newest) keep.add(newest.id);
  }
  const duplicateOf = new Map<string, string>();
  for (const group of duplicates) {
    const members = group.fileIds.map((id) => files.find((f) => f.id === id)!).filter(Boolean);
    const newest = [...members].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))[0];
    for (const m of members) {
      if (m !== newest) duplicateOf.set(m.id, newest?.relativePath ?? '');
    }
  }

  const patterns = options.excludePatterns.map((p) => new RegExp(p, 'i'));
  // selection whitelist (partial clone) — checked LAST so exclusion-rule reasons
  // (unsupported / duplicate / pattern) stay visible on their own rows
  const whitelist = options.includePaths?.length ? new Set(options.includePaths) : null;
  const entries: PackagePreviewPlanEntry[] = files.map((file) => {
    if (options.excludeUnsupported && !file.isSupported) {
      return { path: file.relativePath, size: file.size, included: false, reason: 'Unsupported file type' };
    }
    if (options.excludeDuplicates && duplicateOf.has(file.id)) {
      return {
        path: file.relativePath,
        size: file.size,
        included: false,
        reason: `Duplicate of ${duplicateOf.get(file.id)}`,
      };
    }
    if (file.size > options.maxFileBytes) {
      return { path: file.relativePath, size: file.size, included: false, reason: 'Exceeds size limit' };
    }
    const pattern = patterns.find((p) => p.test(file.relativePath));
    if (pattern) {
      return { path: file.relativePath, size: file.size, included: false, reason: `Matches exclusion pattern ${pattern}` };
    }
    if (whitelist && !whitelist.has(file.relativePath)) {
      return { path: file.relativePath, size: file.size, included: false, reason: 'Not selected' };
    }
    return { path: file.relativePath, size: file.size, included: true, reason: 'Included' };
  });

  return {
    projectId,
    entries,
    includedCount: entries.filter((e) => e.included).length,
    excludedCount: entries.filter((e) => !e.included).length,
    estimatedSize: entries.filter((e) => e.included).reduce((sum, e) => sum + e.size, 0),
  };
}

/** Create the package after explicit user confirmation. */
export async function createPackage(
  projectId: string,
  options: PackageOptions,
): Promise<{ job: JobRecord; manifest: PackageManifest }> {
  const project = store.requireProject(projectId);
  const preview = buildPreview(projectId, options);

  const { job, result } = await jobManager.run<PackageManifest>(projectId, 'package', async ({ report }) => {
    report(1, 2);
    const packageId = `pkg_${crypto.randomUUID().slice(0, 8)}`;
    const dest = path.join(store.projectPackagesDir(projectId), packageId);
    const manifest = await runEngine<PackageManifest>('package', {
      source: project.rootPath,
      dest,
      name: project.name,
      entries: preview.entries.map((e) => ({
        path: e.path,
        included: e.included,
        type: e.path.slice(e.path.lastIndexOf('.')) || 'file',
        projectId,
      })),
    });
    manifest.packageId = packageId;
    manifest.projectId = projectId;
    manifest.downloadUrl = `/api/projects/${projectId}/package/${packageId}/download`;

    const zipPath = path.join(store.projectPackagesDir(projectId), `${packageId}.zip`);
    await zipDirectory(path.join(dest, 'content'), zipPath);

    const stored: PackageManifest = {
      ...manifest,
      files: manifest.files ?? [],
    };
    store.savePackage(projectId, stored, zipPath);
    report(2, 2);
    return stored;
  });
  return { job, manifest: result };
}

function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}
