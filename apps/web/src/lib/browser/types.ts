/**
 * Browser Mode: client-side import + storage.
 *
 * Everything here runs in the visitor's browser — files are fetched and kept
 * locally (IndexedDB), so the hosted API is never involved. That means it
 * works on a free/restarting server, on a blocked datacenter IP, and for the
 * visitor's own folders (which no server can read).
 */

export interface BrowserProject {
  id: string;
  name: string;
  sourceType: 'folder' | 'github' | 'website';
  sourceLabel: string;
  createdAt: string;
  fileCount: number;
  totalSize: number;
}

export interface BrowserFile {
  id: string; // `${projectId}:${relativePath}`
  projectId: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  hash: string;
  blob: Blob;
  /** decoded text for text-like files — powers offline content search */
  text?: string;
}

export interface ImportedFile {
  relativePath: string;
  blob: Blob;
  size: number;
  hash: string;
  text?: string;
}

export interface ImportResult {
  files: ImportedFile[];
  skippedMedia: number;
  truncated: boolean;
}

export interface ImportProgress {
  phase: string;
  completed: number;
  total: number;
  detail?: string;
}

export type ProgressFn = (progress: ImportProgress) => void;

/** Guard rails so a browser import can never run away with memory or quota. */
export const LIMITS = {
  maxFiles: 3000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
};

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  'coverage',
  '.cache',
  '.idea',
  '.vscode',
  '.pytest_cache',
]);

export const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.webm',
  '.mov',
  '.avi',
  '.mkv',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.flac',
  '.aac',
]);

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.xhtml',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.txt',
  '.md',
  '.xml',
  '.svg',
  '.yml',
  '.yaml',
  '.csv',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sql',
  '.sh',
  '.ini',
  '.toml',
  '.vue',
  '.svelte',
]);

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isMediaPath(path: string): boolean {
  return MEDIA_EXTENSIONS.has(extensionOf(path));
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name);
}

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
