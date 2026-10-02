import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, exportApi } from '../services/api';
import type { ProjectDetail } from '../services/api';
import type { FileRecord, JobRecord } from '@projectpack/shared';
import { ErrorBanner, SkeletonCards, ProgressBar } from '../components/ui';
import { ProjectBreadcrumbs } from '../components/Breadcrumbs';
import { useToast } from '../components/Toast';
import { downloadFromUrl } from '../lib/download';
import { useJobProgress } from '../hooks/useJobProgress';
import { formatBytes } from '../lib/format';

const JOB_LABELS: Record<string, string> = {
  scan: 'Scanning project',
  extract: 'Extracting content',
  duplicates: 'Analyzing duplicates',
  package: 'Creating package',
  'github-import': 'Importing repository',
  'website-import': 'Crawling & scanning website',
};

export default function ProjectOverview() {
  const { projectId = '' } = useParams();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [activeJob, setActiveJob] = useState<{ jobId: string; type: string } | null>(null);
  const [pillowHint, setPillowHint] = useState(false);
  // download failures already logged — avoids repeat console warnings on refresh
  const warnedFailures = useRef<Set<string>>(new Set());

  const refresh = useCallback(() => {
    api
      .getProject(projectId)
      .then((p) => {
        setProject(p);
        // Download failures are logged to the browser console (once per URL)
        // instead of a page banner — keeps the UI clean; the import-time toast
        // already summarized them.
        const failures = (p as ProjectDetail).importFailures ?? [];
        for (const f of failures) {
          if (!warnedFailures.current.has(f.url)) {
            warnedFailures.current.add(f.url);
            console.warn(
              `[ProjectPack] Could not download during import (${f.status ?? 'network error'}): ${f.url}`,
            );
          }
        }
      })
      .catch((e) => setError(e.message));
  }, [projectId]);

  useEffect(refresh, [refresh]);

  // Back/Forward cache restore: drop a stale in-flight job bar and re-read state.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setActiveJob(null);
      refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [refresh]);

  // While a scan (e.g. the tail end of a website import) is running, keep the
  // page live instead of showing stale zeros until a manual reload.
  const scanning = project?.status === 'scanning';
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => refresh(), 1500);
    return () => clearInterval(timer);
  }, [scanning, refresh]);

  const job = useJobProgress(activeJob?.jobId ?? null, (finished: JobRecord) => {
    const label = JOB_LABELS[activeJob?.type ?? finished.type] ?? 'Job';
    if (finished.status === 'failed') {
      setError(finished.error ?? 'Job failed');
      notify('error', `${label} failed`, finished.error ?? undefined);
    } else if (activeJob?.type === 'duplicates') {
      const groups = (finished.result as { groups?: number } | undefined)?.groups ?? 0;
      notify(
        groups > 0 ? 'success' : 'info',
        groups > 0 ? 'Duplicates found' : 'No duplicates found',
        groups > 0
          ? `${groups} duplicate group${groups === 1 ? '' : 's'} — open the Duplicate center for details`
          : 'Every file is unique',
      );
    } else {
      notify('success', `${label} complete`);
    }
    // brief pause so the completed bar is visible, then refresh and clear
    setTimeout(() => {
      refresh();
      setActiveJob(null);
    }, 400);
  });

  // When files failed extraction, check whether the cause is a missing
  // Python dependency on this machine (Pillow) and show an actionable hint.
  useEffect(() => {
    const failedCount = project?.stats.failedCount ?? 0;
    if (failedCount === 0) {
      setPillowHint(false);
      return;
    }
    let cancelled = false;
    api
      .getFiles(projectId, { extractionStatus: 'failed' })
      .then((res) => {
        if (!cancelled) {
          setPillowHint(
            res.files.some((f) => (f.extractionError ?? '').includes('Pillow is not installed')),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setPillowHint(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project?.stats.failedCount]);

  async function run(type: 'scan' | 'extract' | 'duplicates') {
    setError('');
    try {
      const storedExclusions =
        (project as unknown as { excludeDirs?: string[] } | null)?.excludeDirs ?? [];
      const { jobId } =
        type === 'scan'
          ? await api.scan(projectId, storedExclusions)
          : type === 'extract'
            ? await api.extract(projectId)
            : await api.analyzeDuplicates(projectId);
      setActiveJob({ jobId, type });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const busy = activeJob !== null;

  if (!project && !error) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={4} />
        <SkeletonCards count={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
      >
        ← Back to workspace
      </button>

      <ProjectBreadcrumbs projectId={projectId} />

      {error && <ErrorBanner message={error} />}

      {pillowHint && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Images could not be analyzed — Pillow is missing.</strong> Install the Python requirements for
          the same Python the API uses —{' '}
          <span className="font-mono text-xs">pip install -r python/file_engine/requirements.txt</span> — then
          click “Extract content” again.
        </div>
      )}

      {scanning && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-4 text-sm text-indigo-800">
          Scan in progress — this page updates automatically, no need to reload.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{project?.name}</h1>
          <p className="font-mono text-xs text-slate-500">{project?.sourceLabel}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void run('scan')}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Rescan
          </button>
          <button
            onClick={() => void run('extract')}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Extract content
          </button>
          <button
            onClick={() => void run('duplicates')}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Find duplicates
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  'Delete this project and all its analysis results? Original source files are never touched.',
                )
              ) {
                api
                  .deleteProject(projectId)
                  .then(() => navigate('/'))
                  .catch((e) => setError(e.message));
              }
            }}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {busy && job && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
          <ProgressBar
            value={job.progress}
            label={`${JOB_LABELS[activeJob?.type ?? job.type] ?? 'Working'} — ${
              job.total > 0 ? `${job.completed}/${job.total} items` : 'preparing…'
            }`}
          />
          {job.status === 'completed' && (
            <p className="mt-2 text-xs text-emerald-700">Completed — refreshing…</p>
          )}
          {job.status === 'failed' && (
            <p className="mt-2 text-xs text-red-700">Failed: {job.error}</p>
          )}
        </div>
      )}

      {project && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Files" value={project.fileCount} />
            <Stat label="Folders" value={project.folderCount} />
            <Stat label="Total size" value={formatBytes(project.totalSize)} />
            <Stat label="Duplicate groups" value={project.stats.duplicateGroupCount} hint="Run duplicate analysis to refresh" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Supported" value={project.stats.supportedCount} hint={`${project.stats.unsupportedCount} unsupported`} />
            <Stat label="Extracted" value={project.stats.extractedCount} />
            <Stat label="Failed" value={project.stats.failedCount} />
            <Stat label="Status" value={<span className="capitalize">{project.status}</span>} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <CardLink to={`/projects/${projectId}/files`}>Browse file tree</CardLink>
            <CardLink to={`/projects/${projectId}/search`}>Search content</CardLink>
            <CardLink to={`/projects/${projectId}/duplicates`}>Duplicate center</CardLink>
            <CardLink to={`/projects/${projectId}/package`}>Create a ProjectPack</CardLink>
            <CardLink to={`/projects/${projectId}/report`}>Analysis report</CardLink>
            <CardLink to={`/projects/${projectId}/prompt`}>Generate project prompt</CardLink>
          </div>

          <ExportPanel projectId={projectId} extractedCount={project.stats.extractedCount} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function CardLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
    >
      {children}
    </Link>
  );
}

function ExportPanel({ projectId, extractedCount }: { projectId: string; extractedCount: number }) {
  const { notify } = useToast();
  const [files, setFiles] = useState<FileRecord[] | null>(null);
  const [extension, setExtension] = useState('all');
  const [limit, setLimit] = useState('');
  const [format, setFormat] = useState<'md' | 'txt' | 'json'>('md');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloadBusy, setDownloadBusy] = useState(false);

  useEffect(() => {
    api
      .getFiles(projectId, {})
      .then((res) => setFiles(res.files))
      .catch(() => setFiles([]));
  }, [projectId, extractedCount]);

  if (files === null) return <SkeletonCards count={1} />;

  const extracted = files.filter((f) => f.extractionStatus === 'extracted');
  const types = [...new Set(extracted.map((f) => f.extension))].sort();
  const matching =
    extension === 'all' ? extracted : extracted.filter((f) => f.extension === extension);
  const maxLimit = matching.length;

  async function exportNow() {
    setBusy(true);
    setError('');
    try {
      const result = await exportApi.create(projectId, {
        format,
        extension: extension === 'all' ? undefined : extension,
        limit: limit.trim() === '' ? undefined : Math.max(1, Number.parseInt(limit, 10)),
      });
      if (result.downloadUrl) {
        setDownloadBusy(true);
        try {
          const name = await downloadFromUrl(result.downloadUrl, `projectpack-export.${format}`);
          notify('success', 'Download complete', `${name} — ${result.fileCount} file${result.fileCount === 1 ? '' : 's'}`);
        } catch (e) {
          notify('error', 'Download failed', (e as Error).message);
        } finally {
          setDownloadBusy(false);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (extracted.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        No extracted content yet — run “Extract content” to enable exports and prompts.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-medium text-slate-900">Export combined content</h3>
      <p className="text-xs text-slate-500">
        Build one document for sharing with an AI. Filter by file type and limit the file count to stay within
        AI context limits.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="text-xs text-slate-600">
          File type
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={extension}
            onChange={(e) => {
              setExtension(e.target.value);
              setLimit('');
            }}
          >
            <option value="all">All types ({extracted.length} files)</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t} ({extracted.filter((f) => f.extension === t).length} files)
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-600">
          Number of files
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder={`All (max ${maxLimit})`}
            inputMode="numeric"
            value={limit}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '');
              setLimit(v === '' ? '' : String(Math.min(Number.parseInt(v, 10), maxLimit)));
            }}
          />
        </label>

        <label className="text-xs text-slate-600">
          Format
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'md' | 'txt' | 'json')}
          >
            <option value="md">Markdown (.md)</option>
            <option value="txt">Plain text (.txt)</option>
            <option value="json">JSON (.json)</option>
          </select>
        </label>

        <div className="flex items-end">
          <button
            onClick={() => void exportNow()}
            disabled={busy || downloadBusy}
            className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {downloadBusy ? 'Downloading…' : busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        Will export {Math.min(limit === '' ? maxLimit : Number.parseInt(limit || '0', 10) || maxLimit, maxLimit)}{' '}
        of {maxLimit} matching file{maxLimit === 1 ? '' : 's'}
        {extension !== 'all' ? ` (${extension})` : ''}.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
