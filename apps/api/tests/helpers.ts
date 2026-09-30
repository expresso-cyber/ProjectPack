import request from 'supertest';
import type { Express } from 'express';
import type { JobRecord } from '@projectpack/shared';

/** Poll a background job until it reaches a terminal state. */
export async function waitForJob(app: Express, jobId: string, timeoutMs = 30000): Promise<JobRecord> {
  const start = Date.now();
  for (;;) {
    const res = await request(app).get(`/api/jobs/${jobId}`);
    if (res.status !== 200) throw new Error(`job ${jobId} disappeared: ${res.status}`);
    if (res.body.status === 'completed' || res.body.status === 'failed') return res.body as JobRecord;
    if (Date.now() - start > timeoutMs) throw new Error(`job ${jobId} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
