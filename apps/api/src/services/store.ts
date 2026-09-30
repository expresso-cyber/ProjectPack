import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ProjectSummary, FileRecord, JobRecord, DuplicateGroup, PackageManifest, WebsiteAssetInfo } from '@projectpack/shared';
import { env } from '../config/env.js';
import { notFound } from '../utils/errors.js';

/**
 * File-backed persistence for the MVP.
 *
 * Everything ProjectPack generates (metadata, extracted text, jobs, packages)
 * lives under DATA_DIR. Original user sources are never written to.
 * This interface is intentionally narrow so a Mongoose implementation can
 * replace it when multi-user persistence is added (see docs/12_DATA_MODELS.md).
 */

export interface ProjectDoc extends ProjectSummary {
  rootPath: string; // local-only; never returned by the API layer
  excludeDirs?: string[]; // extra directory names skipped during scans
  importFailures?: { url: string; status?: number }[]; // website imports: downloads that failed
}

export interface FileFilter {
  extension?: string;
  pathPrefix?: string;
  supported?: boolean;
  extractionStatus?: FileRecord['extractionStatus'];
}

function atomicWriteJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Stable file id: re-scanning the same path updates the same record. */
export function fileIdFor(projectId: string, relativePath: string): string {
  return 'f_' + crypto.createHash('sha256').update(`${projectId}:${relativePath}`).digest('hex').slice(0, 16);
}

export class Store {
  private readonly root: string;

  constructor(dataDir: string = env.dataDir) {
    this.root = dataDir;
    fs.mkdirSync(this.root, { recursive: true });
  }

  private projectDir(projectId: string): string {
    return path.join(this.root, 'projects', projectId);
  }

  // ---- Projects ----

  createProject(input: {
    name: string;
    sourceType: 'local' | 'github' | 'website';
    sourceLabel: string;
    rootPath: string;
    excludeDirs?: string[];
  }): ProjectDoc {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const project: ProjectDoc = {
      id,
      name: input.name,
      sourceType: input.sourceType,
      sourceLabel: input.sourceLabel,
      rootPath: input.rootPath,
      excludeDirs: input.excludeDirs ?? [],
      status: 'created',
      createdAt: now,
      updatedAt: now,
    };
    atomicWriteJson(path.join(this.projectDir(id), 'project.json'), project);
    return project;
  }

  listProjects(): ProjectDoc[] {
    const dir = path.join(this.root, 'projects');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((id) => this.getProject(id))
      .filter((p): p is ProjectDoc => p !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getProject(projectId: string): ProjectDoc | null {
    const file = path.join(this.projectDir(projectId), 'project.json');
    if (!fs.existsSync(file)) return null;
    return readJson<ProjectDoc>(file, null as unknown as ProjectDoc);
  }

  requireProject(projectId: string): ProjectDoc {
    const project = this.getProject(projectId);
    if (!project) throw notFound('Project');
    return project;
  }

  updateProject(projectId: string, patch: Partial<ProjectDoc>): ProjectDoc {
    const project = this.requireProject(projectId);
    const updated = { ...project, ...patch, updatedAt: new Date().toISOString() };
    atomicWriteJson(path.join(this.projectDir(projectId), 'project.json'), updated);
    return updated;
  }

  /** Deletes ProjectPack's own metadata/results only — never source files. */
  deleteProject(projectId: string): void {
    this.requireProject(projectId);
    fs.rmSync(this.projectDir(projectId), { recursive: true, force: true });
  }

  // ---- Files ----

  saveFiles(projectId: string, files: FileRecord[]): void {
    atomicWriteJson(path.join(this.projectDir(projectId), 'files.json'), files);
  }

  getFiles(projectId: string, filter: FileFilter = {}): FileRecord[] {
    const files = readJson<FileRecord[]>(path.join(this.projectDir(projectId), 'files.json'), []);
    return files.filter((f) => {
      if (filter.extension && f.extension !== filter.extension.toLowerCase()) return false;
      if (filter.pathPrefix && !f.relativePath.toLowerCase().includes(filter.pathPrefix.toLowerCase())) return false;
      if (filter.supported !== undefined && f.isSupported !== filter.supported) return false;
      if (filter.extractionStatus && f.extractionStatus !== filter.extractionStatus) return false;
      return true;
    });
  }

  upsertFiles(projectId: string, files: FileRecord[]): void {
    const existing = readJson<FileRecord[]>(path.join(this.projectDir(projectId), 'files.json'), []);
    const byId = new Map(existing.map((f) => [f.id, f]));
    for (const f of files) byId.set(f.id, { ...byId.get(f.id), ...f });
    this.saveFiles(projectId, [...byId.values()]);
  }

  // ---- Folders ----

  saveFolders(projectId: string, folders: Record<string, unknown>[]): void {
    atomicWriteJson(path.join(this.projectDir(projectId), 'folders.json'), folders);
  }

  getFolders(projectId: string): Record<string, unknown>[] {
    return readJson<Record<string, unknown>[]>(path.join(this.projectDir(projectId), 'folders.json'), []);
  }

  // ---- Extracted content ----

  saveContent(projectId: string, fileId: string, text: string): void {
    const dir = path.join(this.projectDir(projectId), 'contents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${fileId}.txt`), text);
  }

  getContent(projectId: string, fileId: string): string | null {
    const file = path.join(this.projectDir(projectId), 'contents', `${fileId}.txt`);
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  // ---- Jobs ----

  saveJob(job: JobRecord): void {
    const jobs = readJson<JobRecord[]>(path.join(this.projectDir(job.projectId), 'jobs.json'), []);
    const idx = jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) jobs[idx] = job;
    else jobs.push(job);
    atomicWriteJson(path.join(this.projectDir(job.projectId), 'jobs.json'), jobs);
  }

  getJob(projectId: string, jobId: string): JobRecord | null {
    const jobs = readJson<JobRecord[]>(path.join(this.projectDir(projectId), 'jobs.json'), []);
    return jobs.find((j) => j.id === jobId) ?? null;
  }

  listJobs(projectId: string): JobRecord[] {
    return readJson<JobRecord[]>(path.join(this.projectDir(projectId), 'jobs.json'), []);
  }

  // ---- Duplicates & report ----

  saveDuplicates(projectId: string, groups: DuplicateGroup[]): void {
    atomicWriteJson(path.join(this.projectDir(projectId), 'duplicates.json'), groups);
  }

  getDuplicates(projectId: string): DuplicateGroup[] {
    return readJson<DuplicateGroup[]>(path.join(this.projectDir(projectId), 'duplicates.json'), []);
  }

  saveReport(projectId: string, report: unknown): void {
    atomicWriteJson(path.join(this.projectDir(projectId), 'report.json'), report);
  }

  getReport(projectId: string): unknown | null {
    const file = path.join(this.projectDir(projectId), 'report.json');
    if (!fs.existsSync(file)) return null;
    return readJson<unknown>(file, null);
  }

  // ---- Packages ----

  savePackage(projectId: string, manifest: PackageManifest, zipPath: string): void {
    const packages = this.getPackages(projectId);
    packages.push(manifest);
    atomicWriteJson(path.join(this.projectDir(projectId), 'packages.json'), { packages, zipPaths: { ...this.getPackageIndex(projectId).zipPaths, [manifest.packageId]: zipPath } });
  }

  private getPackageIndex(projectId: string): { packages: PackageManifest[]; zipPaths: Record<string, string> } {
    return readJson(path.join(this.projectDir(projectId), 'packages.json'), { packages: [], zipPaths: {} });
  }

  getPackages(projectId: string): PackageManifest[] {
    return this.getPackageIndex(projectId).packages;
  }

  getPackage(projectId: string, packageId: string): { manifest: PackageManifest; zipPath: string } {
    const index = this.getPackageIndex(projectId);
    const manifest = index.packages.find((p) => p.packageId === packageId);
    if (!manifest) throw notFound('Package');
    return { manifest, zipPath: index.zipPaths[packageId] };
  }

  // ---- Website crawl metadata (source URLs + alt text per saved file) ----

  saveWebsiteAssets(projectId: string, assets: WebsiteAssetInfo[]): void {
    atomicWriteJson(path.join(this.projectDir(projectId), 'website-assets.json'), assets);
  }

  getWebsiteAssets(projectId: string): WebsiteAssetInfo[] {
    return readJson<WebsiteAssetInfo[]>(path.join(this.projectDir(projectId), 'website-assets.json'), []);
  }

  // ---- Scratch space for python payloads ----

  tmpDir(): string {
    const dir = path.join(this.root, 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  projectPackagesDir(projectId: string): string {
    return path.join(this.projectDir(projectId), 'packages');
  }

  exportsDir(projectId: string): string {
    return path.join(this.projectDir(projectId), 'exports');
  }
}

export const store = new Store();
