import type {
  ProjectSummary,
  TreeResponse,
  FileRecord,
  ContentResponse,
  SearchHit,
  JobRecord,
  PackagePreview,
  PackageManifest,
  ReportResponse,
  ImageInfo,
} from '@projectpack/shared';

const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const BASE = API_ORIGIN ? API_ORIGIN + '/api' : '/api';

export function apiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return API_ORIGIN ? API_ORIGIN + (url.startsWith('/') ? url : '/' + url) : url;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new Error(
      'Cannot reach the ProjectPack API. Make sure it is running: "npm run dev:api" (port 3001).',
    );
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = (body as { error?: { message?: string } }).error?.message;
    const message =
      apiMessage ??
      (response.status === 500
        ? 'The API could not complete this request — is the dev server running? (npm run dev:api)'
        : `Request failed (${response.status})`);
    throw new Error(message);
  }
  return body as T;
}

export interface SearchSuggestion {
  fileId: string;
  relativePath: string;
  name: string;
  extension: string;
  matchedIn: 'name' | 'path' | 'content';
  snippet?: string;
  matches: number;
}

export interface ProjectDetail extends ProjectSummary {
  fileCount: number;
  folderCount: number;
  totalSize: number;
  importFailures?: { url: string; status?: number }[];
  stats: {
    supportedCount: number;
    unsupportedCount: number;
    extractedCount: number;
    failedCount: number;
    duplicateGroupCount: number;
  };
}

export interface DuplicateFile {
  id: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export const api = {
  listProjects: () => request<ProjectSummary[]>('/projects'),

  createProject: (name: string, rootPath: string) =>
    request<ProjectSummary>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, rootPath }),
    }),

  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),

  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  scan: (id: string, exclude: string[] = []) =>
    request<{ jobId: string; job: JobRecord }>(`/projects/${id}/scan`, {
      method: 'POST',
      body: JSON.stringify({ exclude }),
    }),

  extract: (id: string) =>
    request<{ jobId: string; job: JobRecord }>(`/projects/${id}/extract`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getJob: (jobId: string) => request<JobRecord>(`/jobs/${jobId}`),

  getTree: (id: string) => request<TreeResponse>(`/projects/${id}/tree`),

  getFiles: (id: string, query: Record<string, string> = {}) => {
    const params = new URLSearchParams(query).toString();
    return request<{ files: FileRecord[]; total: number }>(`/projects/${id}/files${params ? `?${params}` : ''}`);
  },

  getContent: (id: string, fileId: string) =>
    request<ContentResponse>(`/projects/${id}/files/${fileId}/content`),

  getArchiveListing: (id: string, fileId: string) =>
    fetch(apiUrl(`/api/projects/${id}/files/${fileId}/archive`)).then((r) => r.json()),

  search: (id: string, q: string, content: boolean) =>
    request<{ query: string; hits: SearchHit[]; total: number }>(
      `/projects/${id}/search?q=${encodeURIComponent(q)}&content=${content ? 'true' : 'false'}`,
    ),

  duplicates: (id: string) =>
    request<{ groups: { hash: string; totalBytes: number; files: DuplicateFile[] }[] }>(
      `/projects/${id}/duplicates`,
    ),

  analyzeDuplicates: (id: string) =>
    request<{ jobId: string }>(`/projects/${id}/duplicates`, { method: 'POST', body: JSON.stringify({}) }),

  previewPackage: (id: string, options: PackageOptions) =>
    request<PackagePreview>(`/projects/${id}/package/preview`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  createPackage: (id: string, options: PackageOptions) =>
    request<PackageManifest>(`/projects/${id}/package/create`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true, options }),
    }),

  getPackages: (id: string) =>
    request<{ packages: PackageManifest[] }>(`/projects/${id}/packages`),

  getReport: (id: string) => request<ReportResponse>(`/projects/${id}/report`),

  exportContent: (id: string, format: 'txt' | 'md' | 'json') =>
    request<{ downloadUrl: string; bytes: number }>(`/projects/${id}/export`, {
      method: 'POST',
      body: JSON.stringify({ format }),
    }),

  analyzeGithub: (url: string) =>
    request<{ projectId: string; jobId: string }>('/github/analyze', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  analyzeWebsite: (url: string, name?: string, pages?: string[]) =>
    request<{ projectId: string; jobId: string }>('/website/analyze', {
      method: 'POST',
      body: JSON.stringify({ url, name, pages }),
    }),

  /** Sub-page links found on a site's landing page (for the page picker). */
  listSitePages: (url: string) =>
    request<{ pages: string[] }>('/website/pages', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  /** Autocomplete suggestions for the search box. */
  searchSuggest: (id: string, q: string, limit = 8) =>
    request<{ query: string; suggestions: SearchSuggestion[] }>(
      `/projects/${id}/search/suggest?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  listImages: (id: string) =>
    request<{ images: ImageInfo[]; total: number }>(`/projects/${id}/images`),

  rawFileUrl: (id: string, fileId: string) => apiUrl(`/api/projects/${id}/files/${fileId}/raw`),

  imagesZipUrl: (id: string) => apiUrl(`/api/projects/${id}/images/export`),
};

export interface PackageOptions {
  excludeUnsupported: boolean;
  excludeDuplicates: boolean;
  excludePatterns: string[];
  maxFileBytes: number;
  /** partial-clone selection — only these relative paths get packaged */
  includePaths?: string[];
}

export interface ExportFilters {
  format: 'txt' | 'md' | 'json';
  extension?: string;
  pathPrefix?: string;
  limit?: number;
}

export const exportApi = {
  /** Selective export: filter by file type / folder, cap the file count. */
  create: (id: string, filters: ExportFilters) =>
    request<{ downloadUrl: string; bytes: number; fileCount: number }>(`/projects/${id}/export`, {
      method: 'POST',
      body: JSON.stringify(filters),
    }),
};

export const promptApi = {
  /** Generate the "recreate this project" prompt for AI coding agents. */
  generate: (id: string, includeContent: boolean, maxKbPerFile: number) =>
    request<{ prompt: string; fileCount: number }>(`/projects/${id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ includeContent, maxBytesPerFile: maxKbPerFile * 1024 }),
    }),
};

export const aiApi = {
  status: () => request<{ configured: boolean; model: string }>('/ai/status'),

  /** Optional AI refinement of a generated prompt (requires AI_API_KEY on the API). */
  enhance: (id: string, prompt: string) =>
    request<{ prompt: string; enhancedBy: string; model: string }>(`/projects/${id}/prompt/enhance`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
};
