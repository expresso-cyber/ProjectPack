import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { ProjectSummary, JobRecord } from '@projectpack/shared';
import { EmptyState, ErrorBanner, Modal, ProgressBar, Skeleton, StatCard } from '../components/ui';
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
  // selective website import: pick specific pages instead of crawling everything
  const [sitePages, setSitePages] = useState<string[]>([]);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  // the picker modal (checkbox list) and the "listed links" modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [listedOpen, setListedOpen] = useState(false);
  const [tempSelection, setTempSelection] = useState<string[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importProjectId, setImportProjectId] = useState('');
  const [importKind, setImportKind] = useState<'github' | 'website'>('github');
  // The free hosting plan sleeps when idle and takes ~a minute to wake. Rather
  // than showing an error to a first-time visitor, keep retrying and explain.
  const [wakingUp, setWakingUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const list = await api.listProjects();
        if (cancelled) return;
        setProjects(list);
        setWakingUp(false);
      } catch {
        if (cancelled) return;
        setWakingUp(true);
        timer = window.setTimeout(() => void load(), 4000);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
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

  // Coming back with Back/Forward restores this page from the browser cache
  // with its old state — clear anything mid-flight so nothing looks stuck.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setImportJobId(null);
      setBusy(false);
      void api.listProjects().then(setProjects).catch(() => undefined);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const importJob = useJobProgress(importJobId, (job: JobRecord) => {
    if (job.status === 'completed') {
      const failedCount = ((job.result as { failures?: unknown[] } | null)?.failures ?? []).length;
      if (importKind === 'website' && failedCount > 0) {
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
      // Clear the import UI state *before* navigating: pressing Back would
      // otherwise restore this page from the browser cache with the bar still
      // full and the buttons still disabled (the job is already finished, so
      // nothing would ever reset it).
      setImportJobId(null);
      setBusy(false);
      void api.listProjects().then(setProjects).catch(() => undefined);
      // brief pause so the toast is visible before navigating
      setTimeout(() => {
        window.location.href = `/projects/${importProjectId}`;
      }, 700);
      return;
    }
    // failed — surface the error and stop
    setError(job.error ?? 'Import failed');
    notify('error', 'Import failed', job.error ?? undefined);
    setImportJobId(null);
  });

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

  /** Links shown inside the picker, filtered by the modal's search box. */
  const pickerMatches = useMemo(() => {
    const needle = pickerQuery.trim().toLowerCase();
    return needle ? sitePages.filter((url) => url.toLowerCase().includes(needle)) : sitePages;
  }, [pickerQuery, sitePages]);

  const allPickerSelected =
    sitePages.length > 0 && sitePages.every((url) => tempSelection.includes(url));

  async function loadSitePages() {
    if (!websiteUrl.trim()) {
      notify('error', 'Enter the main URL first', 'Paste the site URL, then load its page links.');
      return;
    }
    setLoadingPages(true);
    try {
      const { pages } = await api.listSitePages(websiteUrl.trim());
      setSitePages(pages);
      setTempSelection(selectedPages.filter((url) => pages.includes(url)));
      setPickerQuery('');
      setPickerOpen(true);
      if (pages.length === 0) notify('info', 'No page links found', 'That page does not link to any other pages.');
    } catch (e) {
      notify('error', 'Could not list pages', (e as Error).message);
    } finally {
      setLoadingPages(false);
    }
  }

  function toggleTemp(url: string) {
    setTempSelection((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]));
  }

  function toggleAllPages() {
    setTempSelection(allPickerSelected ? [] : [...sitePages]);
  }

  function removeSelected(url: string) {
    setSelectedPages((prev) => prev.filter((u) => u !== url));
  }

  async function importWebsite() {
    setBusy(true);
    setError('');
    try {
      const { projectId, jobId } = await api.analyzeWebsite(
        websiteUrl,
        websiteName.trim() || undefined,
        selectedPages.length > 0 ? selectedPages : undefined,
      );
      setImportKind('website');
      setImportProjectId(projectId);
      setImportJobId(jobId);
      setWebsiteUrl('');
      setWebsiteName('');
      setSitePages([]);
      setSelectedPages([]);
      setPickerQuery('');
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

      {wakingUp && projects === null && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            <strong>Starting the demo server…</strong>
          </div>
          <p className="mt-1 text-xs text-amber-800">
            This free hosting plan sleeps after 15 minutes of inactivity and takes about a minute to wake up. This page
            retries automatically — no need to reload.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
          >
            Retry now
          </button>
        </section>
      )}

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
            {importing && importKind === 'github' ? 'Importing…' : 'Import and analyze'}
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

          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/50 p-2">
            <span className="text-xs font-medium text-slate-700">Pages to crawl (optional)</span>
            <p className="mt-1 text-[11px] text-slate-500">
              Leave empty to crawl the whole site (up to 30 pages). Load the site's page links and tick only the ones
              you need — handy when a task asks for just a few pages.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadSitePages()}
                disabled={importing || loadingPages}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingPages ? 'Loading…' : 'Load page links'}
              </button>
              <button
                type="button"
                onClick={() => setListedOpen(true)}
                disabled={selectedPages.length === 0}
                className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
              >
                Listed links ({selectedPages.length})
              </button>
            </div>
            {selectedPages.length > 0 && (
              <p className="mt-2 text-[11px] text-emerald-700">
                Only these {selectedPages.length} page(s) will be fetched — plus the images, CSS and scripts they use.
              </p>
            )}
          </div>
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
                ? 'Crawling & scanning website'
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

      {pickerOpen && (
        <Modal
          title={`Page links found (${sitePages.length})`}
          wide
          onClose={() => setPickerOpen(false)}
          footer={
            <>
              <span className="mr-auto text-xs text-slate-500">
                {tempSelection.length} of {sitePages.length} selected
              </span>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPages(tempSelection);
                  setPickerOpen(false);
                }}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Done
              </button>
            </>
          }
        >
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
            placeholder="Filter these links…"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            autoFocus
          />
          <label className="mt-3 flex items-center gap-2 border-b border-slate-100 pb-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allPickerSelected}
              onChange={toggleAllPages}
            />
            All pages
          </label>
          <ul className="mt-1 divide-y divide-slate-50">
            {pickerMatches.map((url) => (
              <li key={url}>
                <label className="flex items-start gap-2 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={tempSelection.includes(url)}
                    onChange={() => toggleTemp(url)}
                  />
                  <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700">{url}</span>
                </label>
              </li>
            ))}
            {pickerMatches.length === 0 && (
              <li className="py-4 text-center text-xs text-slate-400">No links match that filter.</li>
            )}
          </ul>
        </Modal>
      )}

      {listedOpen && (
        <Modal
          title={`Listed links (${selectedPages.length})`}
          onClose={() => setListedOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setSelectedPages([])}
                className="mr-auto text-xs text-slate-500 underline"
              >
                clear all
              </button>
              <button
                type="button"
                onClick={() => setListedOpen(false)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Done
              </button>
            </>
          }
        >
          <ul className="divide-y divide-slate-100">
            {selectedPages.map((url) => (
              <li key={url} className="flex items-start gap-2 py-2">
                <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700">{url}</span>
                <button
                  type="button"
                  onClick={() => removeSelected(url)}
                  title="Remove this link"
                  className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-400 transition hover:border-red-300 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
            {selectedPages.length === 0 && (
              <li className="py-4 text-center text-xs text-slate-400">
                No links listed — load page links and tick the ones you need.
              </li>
            )}
          </ul>
        </Modal>
      )}

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
