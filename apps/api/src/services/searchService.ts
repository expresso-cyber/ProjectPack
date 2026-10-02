import type { SearchHit } from '@projectpack/shared';
import { store } from './store.js';

export interface SearchOptions {
  query: string;
  inName?: boolean;
  inPath?: boolean;
  inContent?: boolean;
  extension?: string;
  status?: string;
  limit?: number;
}

const SNIPPET_RADIUS = 80;
const MAX_HITS = 100;

/** MVP lexical search across names, paths, and extracted content. */
export function search(projectId: string, options: SearchOptions): { query: string; hits: SearchHit[]; total: number } {
  const { query } = options;
  if (!query.trim()) return { query, hits: [], total: 0 };
  const needle = query.toLowerCase();

  let files = store.getFiles(projectId);
  if (options.extension) files = files.filter((f) => f.extension === options.extension!.toLowerCase());
  if (options.status) files = files.filter((f) => f.extractionStatus === options.status);
  if (!options.inName && !options.inPath && !options.inContent) options.inName = options.inPath = true;

  const hits: SearchHit[] = [];
  for (const file of files) {
    const nameMatch = options.inName && file.name.toLowerCase().includes(needle);
    const pathMatch = options.inPath && file.relativePath.toLowerCase().includes(needle);
    let snippet = '';
    let matches = 0;

    if (options.inContent && file.extractionStatus === 'extracted') {
      const text = store.getContent(projectId, file.id);
      if (text) {
        const lower = text.toLowerCase();
        let idx = lower.indexOf(needle);
        if (idx >= 0) {
          const start = Math.max(0, idx - SNIPPET_RADIUS);
          const end = Math.min(text.length, idx + needle.length + SNIPPET_RADIUS);
          snippet = `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
        }
        while (idx >= 0) {
          matches += 1;
          idx = lower.indexOf(needle, idx + needle.length);
        }
      }
    }

    if (nameMatch || pathMatch || matches > 0) {
      hits.push({
        fileId: file.id,
        relativePath: file.relativePath,
        snippet: snippet || file.contentPreview?.replace(/\s+/g, ' ').slice(0, 160) || '',
        matches: matches + (nameMatch ? 1 : 0) + (pathMatch ? 1 : 0),
      });
    }
  }

  hits.sort((a, b) => b.matches - a.matches);
  return { query, hits: hits.slice(0, options.limit ?? MAX_HITS), total: hits.length };
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

/**
 * Autocomplete suggestions for the search box.
 *
 * Deliberately cheap: names/paths and the stored content preview are checked
 * first (no disk I/O), and full extracted content is only scanned for the
 * files that still fit the suggestion budget.
 */
export function suggest(projectId: string, query: string, limit = 8): SearchSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const files = store.getFiles(projectId);
  const out: SearchSuggestion[] = [];
  const contentCandidates: typeof files = [];

  for (const file of files) {
    const nameHit = file.name.toLowerCase().includes(needle);
    const pathHit = file.relativePath.toLowerCase().includes(needle);
    const preview = file.contentPreview?.toLowerCase() ?? '';
    const previewHit = preview.includes(needle);

    if (nameHit || pathHit || previewHit) {
      out.push({
        fileId: file.id,
        relativePath: file.relativePath,
        name: file.name,
        extension: file.extension,
        matchedIn: nameHit ? 'name' : pathHit ? 'path' : 'content',
        snippet: previewHit ? (file.contentPreview ?? '').replace(/\s+/g, ' ').slice(0, 140) : undefined,
        matches: (nameHit ? 2 : 0) + (pathHit ? 1 : 0) + (previewHit ? 1 : 0),
      });
    } else if (file.extractionStatus === 'extracted') {
      contentCandidates.push(file);
    }
  }

  // Only read stored content when we still need suggestions, and never for
  // more than 120 files — keeps typing responsive on big projects.
  if (out.length < limit) {
    for (const file of contentCandidates.slice(0, 120)) {
      if (out.length >= limit * 2) break;
      const text = store.getContent(projectId, file.id);
      if (!text) continue;
      const lower = text.toLowerCase();
      const idx = lower.indexOf(needle);
      if (idx < 0) continue;
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + needle.length + 60);
      out.push({
        fileId: file.id,
        relativePath: file.relativePath,
        name: file.name,
        extension: file.extension,
        matchedIn: 'content',
        snippet: `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`,
        matches: 1,
      });
    }
  }

  out.sort((a, b) => b.matches - a.matches || a.relativePath.localeCompare(b.relativePath));
  return out.slice(0, limit);
}
