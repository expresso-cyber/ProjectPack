import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { ProjectSummary, JobRecord } from '@projectpack/shared';
import { EmptyState, ErrorBanner, ProgressBar, Skeleton, StatCard } from '../components/ui';
import { useToast } from '../components/Toast';
import { useJobProgress } from '../hooks/useJobProgress';
import { formatBytes, formatDate } from '../lib/format';

export default function Home() {
  const { notify } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteName, setWebsiteName] = useState('');
  const [skipMedia, setSkipMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importProjectId, setImportProjectId] = useState('');
  const [importKind, setImportKind] = useState<'github' | 'website'>('github');

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message));
  }, []);

  async function deleteProject(project: ProjectSummary) {
    if (
      !window.confirm(
        `Delete "${project.name}"? This removes ProjectPack's analysis, packages and ` +
          'extracted content for this project. Nothing on the original website or repository changes.',
      )
    ) {
      return;
    }
    try {
      await api.deleteProject(project.id);
      setProjects((prev) => (prev ? prev.filter((p) => p.id !== project.id) : prev));
      notify('success', 'Project deleted', `${project.name} — its files no longer count in the totals`);
    } catch (e) {
      console.error('[ProjectPack] Project deletion failed:', e);
      notify('error', 'Delete failed', (e as Error).message);
    }
  }

  const importJob = useJobProgress(
    importJobId,
    (job: JobRecord) => {
      if (job.status === 'completed') {
        const result = (job.result ?? {}) as { failures?: unknown[]; reused?: boolean };
        const failedCount = (result.failures ?? []).length;
        if (result.reused) {
          notify(
            'success',
            'Existing project refreshed',
            'Unchanged files were skipped — only what changed was re-fetched.',
          );
        } else if (importKind === 'website' && failedCount > 0) {
          notify(
            'info',
            `Import complete — ${failedCount} file${failedCount === 1 ? '' : 's'} could not be downloaded`,
            'The site may be rate-limiting some assets — re-importing usually recovers them.',
          );
        } else {
          notify(
            'success',
            importKind === 'website' ? 'Website import complete' : 'Repository import complete',
            'Opening the project…',
          );
        }
        // brief pause so the toast is visible before navigating
        setTimeout(() => {
          window.location.href = `/projects/${importProjectId}`;
        }, 700);
        return;
      }
      // failed — a transient toast plus the browser console (no persistent banner)
      console.error('[ProjectPack] Import failed:', job.error);
      notify('error', 'Import failed', job.error ?? undefined);
      setImportJobId(null);
      setBusy(false);
    },
    400,
    () => {
      // The job vanished (API restarted / free instance recycled). Stop the bar
      // and say so plainly instead of polling a dead job forever.
      console.warn('[ProjectPack] Import job was lost (server restarted).');
      notify(
        'error',
        'Import interrupted',
        'The server restarted and lost the job. Nothing is broken — import the site again.',
      );
      setImportJobId(null);
      setBusy(false);
      void api.listProjects().then(setProjects).catch(() => undefined);
    },
  );

  async function createProject() {
    setBusy(true);
    setError('');
    try {
      await api.createProject(name, rootPath);
      notify('success', 'Project created', name);
      setName('');
      setRootPath('');
      setProjects(await api.listProjects());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importGithub() {
    setBusy(true);
    setError('');
    try {
      const { projectId, jobId } = await api.analyzeGithub(githubUrl);
      setImportKind('github');
      setImportProjectId(projectId);
      setImportJobId(jobId);
      setGithubUrl('');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function importWebsite() {
    setBusy(true);
    setError('');
    try {
      const { projectId, jobId } = await api.analyzeWebsite(
        websiteUrl,
        websiteName.trim() || undefined,
        skipMedia,
      );
      setImportKind('website');
      setImportProjectId(projectId);
      setImportJobId(jobId);
      setWebsiteUrl('');
      setWebsiteName('');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const importing = importJobId !== null;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Workspace</h1>
        <p className="mt-1 text-sm text-slate-500">
          Scan a local project folder or import a public GitHub repository, then search, analyze, and package it.
        </p>
      </section>

      {error && <ErrorBanner message={error} />}

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <form
          className="rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void createProject();
          }}
        >
          <h2 className="font-medium text-slate-900">Analyze local project</h2>
          <p className="mt-1 text-xs text-slate-500">The folder is only read — never modified.</p>
          <input
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            placeholder="/absolute/path/to/project"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            required
          />
          <button
            className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
            disabled={busy || importing}
          >
            Create project
          </button>
        </form>

        <form
          className="rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void importGithub();
          }}
        >
          <h2 className="font-medium text-slate-900">GitHub repository</h2>
          <p className="mt-1 text-xs text-slate-500">Public repositories only. Imports and scans the default branch.</p>
          <input
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            placeholder="https://github.com/owner/repo"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            required
            disabled={importing}
          />
          <button
            className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
            disabled={busy || importing}
          >
            {importing ? 'Importing…' : 'Import and analyze'}
          </button>
          {importing && importKind === 'github' && (
            <p className="mt-3 text-xs text-slate-400">
              Downloading & scanning — see the progress bar below the cards.
            </p>
          )}
        </form>

        <form
          className="rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void importWebsite();
          }}
        >
          <h2 className="font-medium text-slate-900">Live website</h2>
          <p className="mt-1 text-xs text-slate-500">
            Crawls the site (same-host pages + assets incl. images), then runs the same analysis pipeline.
          </p>
          <input
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            placeholder="https://example.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            required
            disabled={importing}
          />
          <input
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Project name (optional)"
            value={websiteName}
            onChange={(e) => setWebsiteName(e.target.value)}
            disabled={importing}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={skipMedia}
              onChange={(e) => setSkipMedia(e.target.checked)}
              disabled={importing}
              className="h-4 w-4"
            />
            Skip video/audio files — much faster, much smaller import
          </label>
          <button
            className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
            disabled={busy || importing}
          >
            {importing && importKind === 'website' ? 'Crawling…' : 'Crawl and analyze'}
          </button>
          <p className="mt-2 text-[11px] text-slate-400">
            Bounded crawl (30 pages / 400 assets by default). robots.txt is respected.
          </p>
        </form>
      </section>

      {importing && (
        <section
          aria-live="polite"
          className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-4"
        >
          <ProgressBar
            value={importJob?.progress ?? 4}
            label={
              importKind === 'website'
                ? `Crawling & scanning website${importJob?.detail ? ` — ${importJob.detail}` : ''}`
                : `Downloading & scanning repository — ${importJob?.completed ?? 0}/${importJob?.total || 3} steps`
            }
          />
          <p className="mt-1 text-xs text-slate-400">
            {importKind === 'website'
              ? 'Fetching pages, images and assets in parallel, then scanning and hashing every file — the bar keeps moving until the project is fully indexed, and you are taken to it automatically.'
              : 'Large repositories take a moment — the progress bar updates live.'}
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Projects</h2>
        {projects === null ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-2 h-3 w-48" />
                <div className="mt-3 flex gap-3">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-3 w-14" />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create your first project above — point it at any folder on this machine, or import a public GitHub repository."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to={`/projects/${p.id}`}
                    className="truncate font-medium text-slate-900 hover:text-indigo-600"
                    title={p.name}
                  >
                    {p.name}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {p.sourceType}
                    </span>
                    <button
                      type="button"
                      title="Delete this project"
                      onClick={() => void deleteProject(p)}
                      className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-400 transition hover:border-red-300 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <Link
                  to={`/projects/${p.id}`}
                  className="mt-2 block truncate font-mono text-xs text-slate-500 hover:text-indigo-600"
                  title={p.sourceLabel}
                >
                  {p.sourceLabel}
                </Link>
                <div className="mt-3 flex gap-3 text-xs text-slate-400">
                  <span>{p.fileCount ?? 0} files</span>
                  <span>{formatBytes(p.totalSize ?? 0)}</span>
                  <span className="ml-auto">{formatDate(p.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {projects && projects.length > 0 && (
        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Projects" value={projects.length} />
          <StatCard label="Total files indexed" value={projects.reduce((s, p) => s + (p.fileCount ?? 0), 0)} />
          <StatCard
            label="Total size analyzed"
            value={formatBytes(projects.reduce((s, p) => s + (p.totalSize ?? 0), 0))}
          />
        </section>
      )}
    </div>
  );
}
