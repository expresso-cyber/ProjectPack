// Shared TypeScript contracts between @projectpack/api and @projectpack/web.

export type ProjectSourceType = 'local' | 'github' | 'website';

export interface ProjectSummary {
  id: string;
  name: string;
  sourceType: ProjectSourceType;
  sourceLabel: string;
  status: 'created' | 'scanning' | 'ready' | 'error';
  createdAt: string;
  updatedAt: string;
  fileCount?: number;
  folderCount?: number;
  totalSize?: number;
}

export interface FileRecord {
  id: string;
  projectId: string;
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  modifiedAt: string;
  hash?: string;
  isSupported: boolean;
  isBinary: boolean;
  extractionStatus: 'pending' | 'extracted' | 'failed' | 'skipped';
  extractionError?: string;
  contentPreview?: string;
  pageCount?: number;
  sheetCount?: number;
  slideCount?: number;
}

export interface FolderNode {
  id: string;
  name: string;
  relativePath: string;
  depth: number;
  folders: FolderNode[];
  files: FileRecord[];
}

export interface TreeResponse {
  projectId: string;
  root: FolderNode;
}

export interface JobRecord {
  id: string;
  projectId: string;
  type: 'scan' | 'extract' | 'duplicates' | 'package' | 'github-import' | 'website-import';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  total: number;
  completed: number;
  failed: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  /** human-readable live detail, e.g. "142/411 files · 12.4 MB" */
  detail?: string;
  result?: Record<string, unknown>;
}

export interface DuplicateGroup {
  hash: string;
  fileIds: string[];
  totalBytes: number;
}

export interface ContentResponse {
  fileId: string;
  relativePath: string;
  extractionMethod?: string;
  text: string;
  wordCount?: number;
  lineCount?: number;
  pageCount?: number;
  sheetCount?: number;
  slideCount?: number;
  warnings: string[];
}

export interface SearchHit {
  fileId: string;
  relativePath: string;
  snippet: string;
  matches: number;
}

export interface PackagePreviewPlanEntry {
  path: string;
  size: number;
  included: boolean;
  reason: string;
}

export interface PackagePreview {
  projectId: string;
  entries: PackagePreviewPlanEntry[];
  includedCount: number;
  excludedCount: number;
  estimatedSize: number;
}

export interface PackageManifestEntry {
  path: string;
  size: number;
  hash: string;
  type: string;
}

export interface PackageManifest {
  packageId: string;
  projectId: string;
  createdAt: string;
  algorithm: 'sha256';
  files: PackageManifestEntry[];
  fileCount: number;
  totalSize: number;
  downloadUrl: string;
}

export interface ReportResponse {
  projectId: string;
  generatedAt: string;
  totals: {
    files: number;
    folders: number;
    totalSize: number;
    supported: number;
    unsupported: number;
    extracted: number;
    failed: number;
  };
  largestFiles: { relativePath: string; size: number }[];
  duplicates: { groups: number; wastedBytes: number };
  emptyFolders: string[];
  deepestDepth: number;
  extensionBreakdown: { extension: string; count: number; size: number }[];
  warnings: string[];
}

export interface AnalysisStats {
  fileCount: number;
  folderCount: number;
  totalSize: number;
  supportedCount: number;
  unsupportedCount: number;
  extractedCount: number;
  failedCount: number;
  duplicateGroupCount: number;
  duplicateWastedBytes: number;
}

export interface WebsiteAssetInfo {
  relativePath: string;
  url: string;
  contentType?: string;
  alt?: string;
  /** sha256 computed while the file streamed to disk */
  hash?: string;
  size?: number;
  /** validators kept so a re-import can skip unchanged files (HTTP 304) */
  etag?: string;
  lastModified?: string;
}

export interface ImageInfo {
  fileId: string;
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  width?: number;
  height?: number;
  sourceUrl?: string;
  alt?: string;
  downloadUrl: string;
}

export interface AiStatus {
  configured: boolean;
  model: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
