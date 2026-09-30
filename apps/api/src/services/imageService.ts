import path from 'node:path';
import fs from 'node:fs';
import type { Response } from 'express';
import archiver from 'archiver';
import type { ImageInfo } from '@projectpack/shared';
import { store } from './store.js';
import { AppError } from '../utils/errors.js';

/** Image listing + download support for every project type (not just websites). */

export const IMAGE_FILE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.avif',
  '.bmp',
  '.tiff',
];

const imageExtSet = new Set(IMAGE_FILE_EXTENSIONS);

export function isImageExtension(extension: string): boolean {
  return imageExtSet.has(extension.toLowerCase());
}

/**
 * List all image files of a project. Dimensions come from the Python image
 * extractor's output (when extraction has run); source URL and alt text come
 * from the website crawl metadata when the project is a website import.
 */
export function listImages(projectId: string): { images: ImageInfo[]; total: number } {
  store.requireProject(projectId);
  const files = store.getFiles(projectId).filter((f) => isImageExtension(f.extension));
  const crawlAssets = new Map(store.getWebsiteAssets(projectId).map((a) => [a.relativePath, a]));

  const images: ImageInfo[] = files.map((file) => {
    let width: number | undefined;
    let height: number | undefined;
    if (file.extractionStatus === 'extracted') {
      const text = store.getContent(projectId, file.id) ?? '';
      const match = /Dimensions:\s*(\d+)\s*x\s*(\d+)/i.exec(text);
      if (match) {
        width = Number(match[1]);
        height = Number(match[2]);
      }
    }
    const asset = crawlAssets.get(file.relativePath);
    return {
      fileId: file.id,
      name: file.name,
      relativePath: file.relativePath,
      extension: file.extension,
      size: file.size,
      width,
      height,
      sourceUrl: asset?.url,
      alt: asset?.alt,
      downloadUrl: `/api/projects/${projectId}/files/${file.id}/raw`,
    };
  });

  images.sort((a, b) => b.size - a.size);
  return { images, total: images.length };
}

/** Absolute path of a stored file, verified to stay inside the project source. */
export function rawFilePath(projectId: string, fileId: string): { absPath: string; extension: string } {
  const project = store.requireProject(projectId);
  const file = store.getFiles(projectId).find((f) => f.id === fileId);
  if (!file) throw new AppError('NOT_FOUND', 'File not found', 404);
  const root = path.resolve(project.rootPath);
  const absPath = path.resolve(root, file.relativePath);
  if (absPath !== root && !absPath.startsWith(root + path.sep)) {
    throw new AppError('INVALID_PROJECT_SOURCE', 'Invalid file path', 400);
  }
  return { absPath, extension: file.extension };
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export function contentTypeFor(extension: string): string {
  return CONTENT_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';
}

/** Stream a ZIP of every image in the project to the HTTP response. */
export function streamImagesZip(projectId: string, res: Response, zipName: string): void {
  const { images } = listImages(projectId);
  if (images.length === 0) {
    throw new AppError('INVALID_PROJECT_SOURCE', 'This project has no image files', 409);
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  archive.pipe(res);
  for (const image of images) {
    const { absPath } = rawFilePath(projectId, image.fileId);
    if (fs.existsSync(absPath)) {
      // Flat names (host-dir stripped) so the ZIP stays browsable.
      const flat = image.relativePath.split(/[\\/]/).slice(1).join('__') || image.relativePath;
      archive.file(absPath, { name: flat });
    }
  }
  void archive.finalize();
}
