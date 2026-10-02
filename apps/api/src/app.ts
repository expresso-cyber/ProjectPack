import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  const allowedOrigins = env.frontendOrigins;
  app.use(
    cors({
      origin: (origin, callback) => {
        // Non-browser requests such as curl/health checks do not send Origin.
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    }),
  );

  app.use(helmet());
  app.use(express.json({ limit: '5mb' }));
  if (!env.isTest) {
    app.use(pinoHttp({ logger }));
  }

  // Production uses a separate Render Static Site for the React UI.
  // The API service is intentionally API-only so the frontend can be served
  // from Render's CDN without waiting for this service to wake up.
  app.get('/', (_req, res) => {
    res.json({
      name: 'ProjectPack API',
      status: 'ok',
      health: '/api/health',
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', router);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } });
  });
  app.use(errorHandler);
  return app;
}
