import crypto from 'node:crypto';
import type { JobRecord } from '@projectpack/shared';
import { store } from '../services/store.js';
import { logger } from '../utils/logger.js';

export interface JobContext {
  report: (completed: number, total: number, failed?: number, detail?: string) => void;
}

/**
 * Job runner for the MVP (ADR-006: introduce Redis + BullMQ only when scans
 * become long-running across processes). Jobs persist to the store, so
 * progress survives API restarts as "last known state".
 *
 * `run`  — awaits completion (used by the GitHub import flow and tests).
 * `start` — fires the job in the background and returns immediately; the
 *           client polls GET /api/jobs/:jobId for live progress.
 */
export class JobManager {
  create(projectId: string, type: JobRecord['type']): JobRecord {
    const job: JobRecord = {
      id: crypto.randomUUID(),
      projectId,
      type,
      status: 'running',
      progress: 0,
      total: 0,
      completed: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
    };
    store.saveJob(job);
    return job;
  }

  private async execute<T>(job: JobRecord, work: (ctx: JobContext) => Promise<T>): Promise<T> {
    const report = (completed: number, total: number, failed = 0, detail?: string) => {
      job.completed = completed;
      job.total = total;
      job.failed = failed;
      if (detail !== undefined) job.detail = detail;
      job.progress = total > 0 ? Math.round((completed / total) * 100) : 100;
      store.saveJob(job);
    };
    try {
      const result = await work({ report });
      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      job.result = result as Record<string, unknown>;
      store.saveJob(job);
      return result;
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = new Date().toISOString();
      store.saveJob(job);
      logger.error({ jobId: job.id, err: job.error }, 'job failed');
      throw err;
    }
  }

  async run<T>(
    projectId: string,
    type: JobRecord['type'],
    work: (ctx: JobContext) => Promise<T>,
  ): Promise<{ job: JobRecord; result: T }> {
    const job = this.create(projectId, type);
    const result = await this.execute(job, work);
    return { job, result };
  }

  start(projectId: string, type: JobRecord['type'], work: (ctx: JobContext) => Promise<unknown>): JobRecord {
    const job = this.create(projectId, type);
    void this.execute(job, work).catch(() => {
      // failure is captured in the job record; the poller reports it
    });
    return job;
  }
}

export const jobManager = new JobManager();
