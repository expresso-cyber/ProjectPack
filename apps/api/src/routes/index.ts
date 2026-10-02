import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import archiver from 'archiver';
import { store, type ProjectDoc } from '../services/store.js';
import { runEngine } from '../services/pythonBridge.js';
import { startScan, getTree, startDuplicates } from '../services/scanService.js';
import { startExtraction, getContent } from '../services/extractService.js';
import { search, suggest } from '../services/searchService.js';
import { buildPreview, createPackage, DEFAULT_PACKAGE_OPTIONS } from '../services/packageService.js';
import { getReport, createExport, getExportFile } from '../services/reportService.js';
import { analyzeRepository, repositoryTree } from '../services/githubService.js';
import { buildProjectPrompt, DEFAULT_PROMPT_OPTIONS } from '../services/promptService.js';
import { analyzeWebsite, listSitePages } from '../services/websiteService.js';
import { listImages, streamImagesZip, rawFilePath, contentTypeFor } from '../services/imageService.js';
import { aiStatus, enhancePromptWithAi } from '../services/aiService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound } from '../utils/errors.js';

export const router = Router();

function publicProject(p: ProjectDoc) {
  const { rootPath: _rootPath, ...rest } = p;
  return rest;
}

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  rootPath: z.string().min(1),
  sourceLabel: z.string().max(300).optional(),
});

const packageOptionsSchema = z.object({
  excludeUnsupported: z.boolean().default(DEFAULT_PACKAGE_OPTIONS.excludeUnsupported),
  excludeDuplicates: z.boolean().default(DEFAULT_PACKAGE_OPTIONS.excludeDuplicates),
  excludePatterns: z.array(z.string()).default(DEFAULT_PACKAGE_OPTIONS.excludePatterns),
  maxFileBytes: z.number().int().positive().default(DEFAULT_PACKAGE_OPTIONS.maxFileBytes),
  // partial-clone selection: only these relative paths get packaged
  includePaths: z.array(z.string().min(1).max(500)).max(20000).optional(),
});

// ---- Projects ----

router.get('/projects', (_req, res) => {
  res.json(store.listProjects().map(publicProject));
});

router.post(
  '/projects',
  asyncHandler(async (req, res) => {
    const input = createProjectSchema.parse(req.body);
    if (!fs.existsSync(input.rootPath) || !fs.statSync(input.rootPath).isDirectory()) {
      res.status(400).json({
        error: { code: 'INVALID_PROJECT_SOURCE', message: 'rootPath must be an existing directory' },
      });
      return;
    }
    const project = store.createProject({
      name: input.name,
      sourceType: 'local',
      sourceLabel: input.sourceLabel ?? input.rootPath,
      rootPath: input.rootPath,
    });
    res.status(201).json(publicProject(project));
  }),
);

router.get(
  '/projects/:projectId',
  asyncHandler(async (req, res) => {
    const project = store.requireProject(req.params.projectId);
    const files = store.getFiles(req.params.projectId);
    res.json({
      ...publicProject(project),
      fileCount: project.fileCount ?? files.length,
      folderCount: project.folderCount ?? store.getFolders(req.params.projectId).length,
      totalSize: project.totalSize ?? files.reduce((s, f) => s + f.size, 0),
      stats: {
        supportedCount: files.filter((f) => f.isSupported).length,
        unsupportedCount: files.filter((f) => !f.isSupported).length,
        extractedCount: files.filter((f) => f.extractionStatus === 'extracted').length,
        failedCount: files.filter((f) => f.extractionStatus === 'failed').length,
        duplicateGroupCount: store.getDuplicates(req.params.projectId).length,
      },
    });
  }),
);

/** Deletes ProjectPack's own metadata/results — never original source files. */
router.delete(
  '/projects/:projectId',
  asyncHandler(async (req, res) => {
    store.deleteProject(req.params.projectId);
    res.status(204).send();
  }),
);

// ---- Scan ----

const scanSchema = z.object({
  exclude: z.array(z.string().min(1).max(100)).max(50).optional(),
});

router.post(
  '/projects/:projectId/scan',
  asyncHandler(async (req, res) => {
    const { exclude } = scanSchema.parse(req.body ?? {});
    if (exclude) {
      // persist the exclusion rules so rescans and the UI stay in sync
      store.updateProject(req.params.projectId, { excludeDirs: exclude });
    }
    const job = startScan(req.params.projectId);
    res.status(202).json({ jobId: job.id, job });
  }),
);

// ---- Jobs ----

router.get(
  '/jobs/:jobId',
  asyncHandler(async (req, res) => {
    for (const project of store.listProjects()) {
      const job = store.getJob(project.id, req.params.jobId);
      if (job) {
        res.json(job);
        return;
      }
    }
    throw notFound('Job');
  }),
);

// ---- Files ----

router.get(
  '/projects/:projectId/files',
  asyncHandler(async (req, res) => {
    const { extension, path: pathFilter, supported, extractionStatus } = req.query;
    const files = store.getFiles(req.params.projectId, {
      extension: typeof extension === 'string' ? extension : undefined,
      pathPrefix: typeof pathFilter === 'string' ? pathFilter : undefined,
      supported: supported === 'true' ? true : supported === 'false' ? false : undefined,
      extractionStatus:
        typeof extractionStatus === 'string'
          ? (extractionStatus as 'pending' | 'extracted' | 'failed' | 'skipped')
          : undefined,
    });
    res.json({ files, total: files.length });
  }),
);

router.get(
  '/projects/:projectId/tree',
  asyncHandler(async (req, res) => {
    res.json(getTree(req.params.projectId));
  }),
);

router.get(
  '/projects/:projectId/files/:fileId/content',
  asyncHandler(async (req, res) => {
    res.json(getContent(req.params.projectId, req.params.fileId));
  }),
);

/** Archive inspection: list ZIP contents without extracting anything. */
router.get(
  '/projects/:projectId/files/:fileId/archive',
  asyncHandler(async (req, res) => {
    const project = store.requireProject(req.params.projectId);
    const file = store.getFiles(req.params.projectId).find((f) => f.id === req.params.fileId);
    if (!file) throw notFound('File');
    if (file.extension !== '.zip') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Archive inspection supports .zip files only' },
      });
      return;
    }
    const archivePath = path.join(project.rootPath, file.relativePath);
    const listing = await runEngine<{
      ok: boolean;
      error?: string;
      entryCount?: number;
      totalUncompressedSize?: number;
      truncated?: boolean;
      entries?: { name: string; size: number; compressedSize: number; isDir: boolean }[];
    }>('inspect-archive', { archive: archivePath });
    if (!listing.ok) {
      res.status(422).json({
        error: { code: 'INVALID_PROJECT_SOURCE', message: listing.error ?? 'Not a valid archive' },
      });
      return;
    }
    res.json(listing);
  }),
);

// ---- Raw file download / image thumbnails ----

router.get(
  '/projects/:projectId/files/:fileId/raw',
  asyncHandler(async (req, res) => {
    const { absPath, extension } = rawFilePath(req.params.projectId, req.params.fileId);
    if (!fs.existsSync(absPath)) throw notFound('File');
    const contentType = contentTypeFor(extension);
    res.setHeader('Content-Type', contentType);
    // ?download=1 forces a download even for inline-viewable types (images)
    const forceDownload = req.query.download === '1';
    res.setHeader(
      'Content-Disposition',
      `${!forceDownload && contentType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${path.basename(absPath)}"`,
    );
    fs.createReadStream(absPath).pipe(res);
  }),
);

/**
 * ZIP of one folder from the scan index — lets the user download any part of
 * the mirror (a single site section, one domain's folder, etc.). Only folders
 * present in the index can be fetched, which also blocks path traversal.
 */
router.get(
  '/projects/:projectId/folder/download',
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const project = store.requireProject(projectId);
    const folderPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!store.getFolders(projectId).some((f) => f.relativePath === folderPath)) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Folder not found in the scan index' },
      });
      return;
    }
    const files = store
      .getFiles(projectId, { pathPrefix: folderPath })
      .filter((f) => fs.existsSync(path.join(project.rootPath, f.relativePath)));
    if (files.length === 0) {
      res.status(409).json({
        error: { code: 'INVALID_PROJECT_SOURCE', message: 'Folder has no downloadable files' },
      });
      return;
    }
    const folderName = folderPath.split('/').pop() || 'folder';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`);
    const archive = archiver('zip');
    archive.on('error', () => res.destroy());
    archive.pipe(res);
    for (const file of files) {
      archive.file(path.join(project.rootPath, file.relativePath), {
        name: file.relativePath.slice(folderPath.length + 1),
      });
    }
    void archive.finalize();
  }),
);

// ---- Images ----

router.get(
  '/projects/:projectId/images',
  asyncHandler(async (req, res) => {
    res.json(listImages(req.params.projectId));
  }),
);

/** ZIP of every image in the project (for the download-all gallery action). */
router.get(
  '/projects/:projectId/images/export',
  asyncHandler(async (req, res) => {
    streamImagesZip(req.params.projectId, res, `${req.params.projectId}-images.zip`);
  }),
);

// ---- Extract ----

router.post(
  '/projects/:projectId/extract',
  asyncHandler(async (req, res) => {
    const job = startExtraction(req.params.projectId);
    res.status(202).json({ jobId: job.id, job });
  }),
);

// ---- Search ----

router.get(
  '/projects/:projectId/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(
      search(req.params.projectId, {
        query: q,
        inName: req.query.name !== 'false',
        inPath: req.query.path !== 'false',
        inContent: req.query.content === 'true',
        extension: typeof req.query.extension === 'string' ? req.query.extension : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      }),
    );
  }),
);

/** Autocomplete for the search box: file suggestions as you type. */
router.get(
  '/projects/:projectId/search/suggest',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = Math.min(Number(req.query.limit ?? 8) || 8, 20);
    res.json({ query: q, suggestions: suggest(req.params.projectId, q, limit) });
  }),
);

// ---- Duplicates ----

router.post(
  '/projects/:projectId/duplicates',
  asyncHandler(async (req, res) => {
    const job = startDuplicates(req.params.projectId);
    res.status(202).json({ jobId: job.id, job });
  }),
);

router.get(
  '/projects/:projectId/duplicates',
  asyncHandler(async (req, res) => {
    const groups = store.getDuplicates(req.params.projectId);
    const files = store.getFiles(req.params.projectId);
    res.json({
      groups: groups.map((g) => ({
        hash: g.hash,
        totalBytes: g.totalBytes,
        files: g.fileIds
          .map((id) => files.find((f) => f.id === id))
          .filter((f): f is NonNullable<typeof f> => Boolean(f))
          .map((f) => ({ id: f.id, relativePath: f.relativePath, size: f.size, modifiedAt: f.modifiedAt })),
      })),
    });
  }),
);

// ---- ProjectPack (package) ----

router.post(
  '/projects/:projectId/package/preview',
  asyncHandler(async (req, res) => {
    const options = packageOptionsSchema.parse(req.body ?? {});
    res.json(buildPreview(req.params.projectId, options));
  }),
);

router.post(
  '/projects/:projectId/package/create',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ confirm: z.literal(true, { message: 'Explicit confirmation (confirm: true) is required' }), options: packageOptionsSchema.default(packageOptionsSchema.parse({})) })
      .parse(req.body);
    const { manifest } = await createPackage(req.params.projectId, body.options);
    res.status(201).json(manifest);
  }),
);

router.get(
  '/projects/:projectId/package/:packageId/manifest',
  asyncHandler(async (req, res) => {
    const { manifest } = store.getPackage(req.params.projectId, req.params.packageId);
    res.json(manifest);
  }),
);

router.get(
  '/projects/:projectId/package/:packageId/download',
  asyncHandler(async (req, res) => {
    const { manifest, zipPath } = store.getPackage(req.params.projectId, req.params.packageId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${manifest.packageId}.zip"`);
    fs.createReadStream(zipPath).pipe(res);
  }),
);

router.get(
  '/projects/:projectId/packages',
  asyncHandler(async (req, res) => {
    res.json({ packages: store.getPackages(req.params.projectId) });
  }),
);

// ---- Report & Export ----

router.get(
  '/projects/:projectId/report',
  asyncHandler(async (req, res) => {
    res.json(await getReport(req.params.projectId));
  }),
);

const exportSchema = z.object({
  format: z.enum(['txt', 'md', 'json']).default('md'),
  extension: z.string().regex(/^\.[a-z0-9]+$/i, 'extension like .py').optional(),
  pathPrefix: z.string().max(500).optional(),
  limit: z.number().int().positive().max(100000).optional(),
});

router.post(
  '/projects/:projectId/export',
  asyncHandler(async (req, res) => {
    const { format, extension, pathPrefix, limit } = exportSchema.parse(req.body ?? {});
    const result = await createExport(req.params.projectId, format, { extension, pathPrefix, limit });
    if (result.fileCount === 0) {
      res.status(409).json({
        error: {
          code: 'INVALID_PROJECT_SOURCE',
          message: 'No extracted files match these filters',
        },
      });
      return;
    }
    res.status(201).json(result);
  }),
);

// ---- Project prompt ----

const promptSchema = z.object({
  includeContent: z.boolean().default(DEFAULT_PROMPT_OPTIONS.includeContent),
  maxBytesPerFile: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .default(DEFAULT_PROMPT_OPTIONS.maxBytesPerFile),
});

router.post(
  '/projects/:projectId/prompt',
  asyncHandler(async (req, res) => {
    const options = promptSchema.parse(req.body ?? {});
    const result = buildProjectPrompt(req.params.projectId, options);
    res.json(result);
  }),
);

/** Optional AI refinement of a generated prompt (ADR-007: opt-in only). */
router.post(
  '/projects/:projectId/prompt/enhance',
  asyncHandler(async (req, res) => {
    const project = store.requireProject(req.params.projectId);
    const body = z
      .object({ prompt: z.string().min(1).max(600_000) })
      .parse(req.body);
    const enhanced = await enhancePromptWithAi(body.prompt, project.name);
    res.json({ prompt: enhanced, enhancedBy: 'ai', model: aiStatus().model });
  }),
);

router.get(
  '/projects/:projectId/exports/:fileName',
  asyncHandler(async (req, res) => {
    const file = getExportFile(req.params.projectId, req.params.fileName);
    if (!file) throw notFound('Export');
    res.download(file);
  }),
);

// ---- GitHub ----

router.post(
  '/github/analyze',
  asyncHandler(async (req, res) => {
    const body = z.object({ url: z.string().min(8), name: z.string().max(200).optional() }).parse(req.body);
    const { projectId, job } = await analyzeRepository(body.url, body.name);
    res.status(202).json({ projectId, jobId: job.id, job });
  }),
);

router.post(
  '/github/tree',
  asyncHandler(async (req, res) => {
    const body = z.object({ url: z.string().min(8) }).parse(req.body);
    res.json(await repositoryTree(body.url));
  }),
);

// ---- Website ----

/** Crawl a live website (pages + assets incl. images) and run the full pipeline. */
router.post(
  '/website/analyze',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        url: z.string().min(8),
        name: z.string().min(1).max(200).optional(),
        // selective import: only these pages are fetched (assets included)
        pages: z.array(z.string().min(4).max(2000)).max(200).optional(),
      })
      .parse(req.body);
    const { projectId, job } = await analyzeWebsite(body.url, body.name, { pages: body.pages });
    res.status(202).json({ projectId, jobId: job.id, job });
  }),
);

/** Page links found on a site's landing page — powers the page picker. */
router.post(
  '/website/pages',
  asyncHandler(async (req, res) => {
    const body = z.object({ url: z.string().min(8) }).parse(req.body);
    res.json({ pages: await listSitePages(body.url) });
  }),
);

// ---- AI status ----

router.get('/ai/status', (_req, res) => {
  res.json(aiStatus());
});
