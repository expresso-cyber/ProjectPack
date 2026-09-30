import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  if (!env.isTest) {
    app.use(pinoHttp({ logger }));
  }

  // ---- Production: serve the built web UI from the API (single-service deploy) ----
  // When apps/web/dist exists (npm run build), the API hosts the UI itself, so
  // one process serves everything on one port. In dev the dist folder is absent
  // and these are no-ops (vite serves the UI on :5173 with a /api proxy).
  const webDistDir = process.env.WEB_DIST_DIR
    ? path.resolve(process.env.WEB_DIST_DIR)
    : fileURLToPath(new URL('../../web/dist', import.meta.url));
  const serveWebUi = fs.existsSync(webDistDir);
  if (serveWebUi) {
    app.use(express.static(webDistDir));
  }

  if (!serveWebUi) {
    app.get('/', (_req, res) => {
      // Friendly landing response so opening the API root in a browser is not a 404.
      res.json({
        name: 'ProjectPack API',
        status: 'ok',
        webUi: 'http://localhost:5173 (run "npm run dev:web")',
        health: '/api/health',
      });
    });
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', router);

  if (serveWebUi) {
    // SPA history fallback: any non-/api GET that didn't match a real file
    // gets index.html so client-side routes survive a page refresh.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(webDistDir, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } });
  });
  app.use(errorHandler);
  return app;
}
