import { useEffect, useRef, useState } from 'react';
import type { JobRecord } from '@projectpack/shared';
import { api } from '../services/api';

/**
 * Polls a background job until it reaches a terminal state.
 * Pass `null` as jobId to stop polling / when idle.
 */
export function useJobProgress(
  jobId: string | null,
  onComplete?: (job: JobRecord) => void,
  intervalMs = 400,
): JobRecord | null {
  const [job, setJob] = useState<JobRecord | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    setJob(null);
    completedRef.current = false;
    if (!jobId) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const current = await api.getJob(jobId);
        if (cancelled) return;
        setJob(current);
        if (current.status === 'completed' || current.status === 'failed') {
          if (!completedRef.current) {
            completedRef.current = true;
            onComplete?.(current);
          }
          return; // terminal — stop polling
        }
      } catch {
        // transient poll failure — keep trying
      }
      if (!cancelled) setTimeout(() => void tick(), intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, intervalMs]);

  return job;
}
