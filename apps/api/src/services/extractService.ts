import os from 'node:os';
import type { FileRecord, JobRecord, ContentResponse } from '@projectpack/shared';
import { store } from './store.js';
import { runEngine } from './pythonBridge.js';
import { jobManager } from '../jobs/jobManager.js';
import { chunk } from './scanService.js';
import { notFound } from '../utils/errors.js';

interface EngineExtractionResult {
  fileId: string;
  success: boolean;
  extractor: string;
  text: string;
  wordCount: number;
  lineCount: number;
  pageCount?: number;
  sheetCount?: number;
  slideCount?: number;
  warnings: string[];
  error?: string;
  durationMs: number;
}

/**
 * Friendly, actionable extraction errors — the raw engine message can be
 * cryptic for end users (e.g. a missing Python package on their machine).
 */
function friendlyExtractionError(error?: string): string | undefined {
  if (!error) return undefined;
  if (error.includes('pillow is not installed')) {
    return (
      'Pillow is not installed, so images cannot be analyzed. Run: ' +
      'pip install -r python/file_engine/requirements.txt  (or pip install pillow) ' +
      'for the same Python the API uses, then click “Extract content” again.'
    );
  }
  return error;
}

/** Parallel engine processes — bounded so we do not thrash the machine. */
const CONCURRENCY = Math.max(1, Math.min(4, os.cpus().length));
const BATCH = 40;

/** Start extraction in the background; the client polls /api/jobs/:jobId. */
export function startExtraction(projectId: string): JobRecord {
  store.requireProject(projectId);
  return jobManager.start(projectId, 'extract', ({ report }) => extractionWork(projectId, report));
}

/** Extraction work (shared with the awaited variant). */
async function extractionWork(
  projectId: string,
  report: (completed: number, total: number, failed?: number) => void,
): Promise<Record<string, unknown>> {
  const project = store.requireProject(projectId);
  const pending = store
    .getFiles(projectId)
    .filter((f) => f.isSupported && f.extractionStatus !== 'extracted');
  {
    let done = 0;
    let failed = 0;
    const batches = chunk(pending, BATCH);

    // Worker pool: each worker pulls the next batch and runs it in its own
    // Python process. Store updates happen in synchronous completion handlers,
    // so Node's single thread serializes them safely.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < batches.length) {
        const batch = batches[cursor];
        cursor += 1;

        const results = await runEngine<EngineExtractionResult[]>('extract', {
          source: project.rootPath,
          files: batch.map((f) => ({ relativePath: f.relativePath, extension: f.extension })),
        });

        const updated: FileRecord[] = batch.map((file) => {
          const res = results.find((r) => r.fileId === file.relativePath);
          if (!res) {
            return { ...file, extractionStatus: 'failed', extractionError: 'No engine result' };
          }
          if (!res.success) {
            failed += 1;
            return {
              ...file,
              extractionStatus: res.error === 'unsupported file type' ? 'skipped' : 'failed',
              extractionError: friendlyExtractionError(res.error),
            };
          }
          return {
            ...file,
            extractionStatus: 'extracted' as const,
            extractionError: undefined,
            pageCount: res.pageCount,
            sheetCount: res.sheetCount,
            slideCount: res.slideCount,
            contentPreview: res.text.slice(0, 200),
          };
        });
        store.upsertFiles(projectId, updated);

        // Persist extracted text for search and content viewing.
        for (const file of updated) {
          if (file.extractionStatus !== 'extracted') continue;
          const res = results.find((r) => r.fileId === file.relativePath);
          if (res) store.saveContent(projectId, file.id, res.text);
        }

        done += batch.length;
        report(done, pending.length, failed);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()),
    );

    const all = store.getFiles(projectId);
    return {
      extracted: all.filter((f) => f.extractionStatus === 'extracted').length,
      failed: all.filter((f) => f.extractionStatus === 'failed').length,
      total: all.length,
    };
  }
}

/** Content view for a single file. */
export function getContent(projectId: string, fileId: string): ContentResponse {
  const file = store
    .getFiles(projectId)
    .find((f) => f.id === fileId);
  if (!file) throw notFound('File');
  const text = store.getContent(projectId, fileId);
  if (text === null) {
    return {
      fileId,
      relativePath: file.relativePath,
      text: '',
      warnings: [
        file.extractionStatus === 'pending'
          ? 'Extraction has not run for this file yet.'
          : `Extraction status: ${file.extractionStatus}${file.extractionStatus === 'failed' && file.extractionError ? ` — ${file.extractionError}` : ''}`,
      ],
    };
  }
  return {
    fileId,
    relativePath: file.relativePath,
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    lineCount: text.split('\n').length,
    pageCount: file.pageCount,
    sheetCount: file.sheetCount,
    slideCount: file.slideCount,
    warnings: [],
  };
}
