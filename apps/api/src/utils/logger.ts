import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
