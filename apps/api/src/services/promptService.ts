import type { FileRecord } from '@projectpack/shared';
import { store } from './store.js';
import { IMAGE_FILE_EXTENSIONS } from './imageService.js';
import { AppError } from '../utils/errors.js';

export interface PromptOptions {
  includeContent: boolean;
  maxBytesPerFile: number;
}

export const DEFAULT_PROMPT_OPTIONS: PromptOptions = {
  includeContent: true,
  maxBytesPerFile: 20_000,
};

/**
 * Deterministically builds a professional "recreate this project" prompt from
 * the stored scan + extraction data (no AI involved — per ADR-007 the core
 * stays deterministic; the user carries this prompt to the AI of their choice).
 */
export function buildProjectPrompt(projectId: string, options: PromptOptions): { prompt: string; fileCount: number } {
  const project = store.requireProject(projectId);
  const files = store.getFiles(projectId);
  if (files.length === 0) {
    throw new AppError('INVALID_PROJECT_SOURCE', 'Project has no scan results yet — run a scan first', 409);
  }
  const folders = store.getFolders(projectId) as { relativePath: string }[];

  const extensionCounts = new Map<string, { count: number; size: number }>();
  for (const f of files) {
    const key = f.extension || '(none)';
    const entry = extensionCounts.get(key) ?? { count: 0, size: 0 };
    entry.count += 1;
    entry.size += f.size;
    extensionCounts.set(key, entry);
  }

  const lines: string[] = [];
  lines.push('# Project Recreation Prompt');
  lines.push('');
  lines.push(
    'You are a senior software engineer. Recreate the complete project described below as a working codebase. ' +
      'Follow the structure and file contents exactly, then verify the result.',
  );
  lines.push('');
  lines.push('## Project overview');
  lines.push(`- Project name: ${project.name}`);
  lines.push(`- Source: ${project.sourceLabel}`);
  if (project.sourceType === 'website') {
    lines.push('- Source type: live website mirror (HTML/CSS/JS/assets downloaded from the site)');
  }
  lines.push(`- ${files.length} files across ${folders.length} folders (~${Math.round(files.reduce((s, f) => s + f.size, 0) / 1024)} KB total)`);
  lines.push(
    '- File types: ' +
      [...extensionCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([ext, v]) => `${ext} (${v.count} file${v.count === 1 ? '' : 's'})`)
        .join(', '),
  );
  lines.push('');
  lines.push('## Directory structure');
  lines.push('');
  lines.push('```text');
  for (const folder of folders) lines.push(`${folder.relativePath}/`);
  for (const f of files) lines.push(`${f.relativePath}  (${Math.max(1, Math.round(f.size / 1024))} KB)`);
  lines.push('```');
  lines.push('');
  lines.push('## Build instructions');
  lines.push('1. Recreate every file at exactly the relative path shown (including subfolders).');
  lines.push('2. Preserve all naming, structure, and logic as provided.');
  lines.push('3. If a file\'s content was not extracted (binary or unsupported), create a sensible placeholder and note it.');
  lines.push('4. After writing all files, print the final directory tree so the result can be verified against the structure above.');
  lines.push('');

  // Image manifest — images are real files in the project folder; the AI
  // should reference them, not recreate them as code.
  const imageExtSet = new Set(IMAGE_FILE_EXTENSIONS);
  const imageFiles = files.filter((f) => imageExtSet.has(f.extension));
  if (imageFiles.length > 0) {
    const crawlAssets = new Map(store.getWebsiteAssets(projectId).map((a) => [a.relativePath, a]));
    lines.push('## Images & visual assets');
    lines.push(
      `${imageFiles.length} image files are part of this project (they are included in the downloadable project ` +
        'folder / can be downloaded individually). Reference them by their relative path — do NOT try to recreate them as code:',
    );
    lines.push('');
    for (const img of [...imageFiles].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      const meta: string[] = [`${Math.max(1, Math.round(img.size / 1024))} KB`];
      const asset = crawlAssets.get(img.relativePath);
      if (asset?.alt) meta.push(`alt: "${asset.alt}"`);
      if (asset?.url) meta.push(`source: ${asset.url}`);
      lines.push(`- ${img.relativePath} (${meta.join(' · ')})`);
    }
    lines.push('');
  }

  let included = 0;
  if (options.includeContent) {
    lines.push('## File contents');
    lines.push('');
    for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      const content = file.extractionStatus === 'extracted' ? store.getContent(projectId, file.id) : null;
      lines.push(`### ${file.relativePath}`);
      lines.push('');
      if (content === null) {
        lines.push('```');
        lines.push(`(content not extracted — ${file.extractionStatus})`);
        lines.push('```');
        lines.push('');
        continue;
      }
      included += 1;
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > options.maxBytesPerFile) {
        const truncated = content.slice(0, options.maxBytesPerFile);
        lines.push('```' + file.extension.replace('.', ''));
        lines.push(truncated);
        lines.push('```');
        lines.push(
          `> Note: truncated to ${Math.round(options.maxBytesPerFile / 1024)} KB of ${Math.round(bytes / 1024)} KB — the original file is larger.`,
        );
      } else {
        lines.push('```' + file.extension.replace('.', ''));
        lines.push(content);
        lines.push('```');
      }
      lines.push('');
    }
  } else {
    lines.push('## Scope');
    lines.push(
      'Only the structure is provided above. Infer a sensible implementation for each file based on its path, ' +
        'name, type, and the project type, then list any assumptions you made.',
    );
    lines.push('');
  }

  lines.push('---');
  lines.push(
    'End of project specification. Recreate the project now. Ask for clarification only if a requirement is ' +
      'genuinely ambiguous; otherwise make reasonable engineering decisions and document them.',
  );

  return { prompt: lines.join('\n'), fileCount: options.includeContent ? included : 0 };
}
