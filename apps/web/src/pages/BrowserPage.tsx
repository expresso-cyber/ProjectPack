import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorBanner, ProgressBar, StatCard } from '../components/ui';
import { FileIcon } from '../components/ui';
import { useToast } from '../components/Toast';
import { formatBytes, formatDate } from '../lib/format';
import {
  DEFAULT_PROXY,
  browserDuplicates,
  deleteBrowserProject,
  downloadBlob,
  downloadProjectZip,
  folderCount,
  folderPickerAvailable,
  importGithubRepo,
  importLocalFolder,
  importWebsite,
  listBrowserFiles,
  listBrowserProjects,
  pickFolder,
  saveBrowserProject,
  searchBrowserFiles,
} from '../lib/browser';
import type { BrowserFile, BrowserProject, ImportProgress } from '../lib/browser';

type SourceKind = 'folder' | 'github' | 'website';

const SOURCE_LABEL: Record<SourceKind, string> = {
  folder: 'Local folder',
  github: 'GitHub repository',
  website: 'Live website',
};

/**
 * Browser Mode — importing, analysing and downloading entirely inside the
 * browser (IndexedDB storage). The hosted API is never involved, so nothing
 * here depends on the server's memory, disk or network.
 */
export default function BrowserPage() {
  const { notify } = useToast();
  const [projects, setProjects] = useState<BrowserProject[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [files, setFiles] = useState<BrowserFile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<SourceKind | ''>('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [query, setQuery] = useState('');
  const [duplicates, setDuplicates] = useState<{ hash: string; files: BrowserFile[] }[] | null>(null);
  const [zipping, setZipping] = useState(false);

  const [githubUrl, setGithubUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [proxy, setProxy] = useState(DEFAULT_PROXY);
  const [skipMedia, setSkipMedia] = useState(true);

  const canPickFolders = useMemo(() => folderPickerAvailable(), []);
  const selected = projects?.find((p) => p.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const list = await listBrowserProjects();
      setProjects(list);
      if (!selectedId && list.length > 0) setSelectedId(list[0].id);
      if (selectedId && !list.some((p) => p.id === selectedId)) setSelectedId(list[0]?.id ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setFiles([]);
      return;
    }
    setDuplicates(null);
    listBrowserFiles(selectedId)
      .then(setFiles)
      .catch((e) => setError((e as Error).message));
  }, [selectedId]);

  async function run(kind: SourceKind, work: () => Promise<{ result: Awaited<ReturnType<typeof importLocalFolder>>; name: string; label: string }>) {
    setBusy(kind);
    setError('');
    setProgress({ phase: 'Starting…', completed: 0, total: 0 });
    try {
      const { result, name, label } = await work();
      const project = await saveBrowserProject({ name, sourceType: kind, sourceLabel: label, result });
      await refresh();
      setSelectedId(project.id);
      const skipped = result.skippedMedia > 0 ? ` · ${result.skippedMedia} media skipped` : '';
      const truncated = result.truncated ? ' (size limits reached — some files were skipped)' : '';
      notify(
        'success',
        `${SOURCE_LABEL[kind]} stored in this browser`,
        `${result.files.length} files · ${formatBytes(project.totalSize)}${skipped}${truncated}`,
      );
    } catch (e) {
      console.error('[ProjectPack] Browser import failed:', e);
      notify('error', 'Import failed', (e as Error).message);
      setError((e as Error).message);
    } finally {
      setBusy('');
      setProgress(null);
    }
  }

  const importFolder = () =>
    run('folder', async () => {
      const handle = await pickFolder();
      if (!handle) throw new Error('No folder selected.');
      const result = await importLocalFolder(handle, setProgress, skipMedia);
      return { result, name: handle.name, label: `Local folder: ${handle.name}` };
    });

  const importGithub = () =>
    run('github', async () => {
      const result = await importGithubRepo(githubUrl, setProgress, skipMedia);
      const repo = githubUrl.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
      return { result, name: repo || 'GitHub repository', label: githubUrl.trim() };
    });

  const importSite = () =>
    run('website', async () => {
      const result = await importWebsite(websiteUrl, setProgress, { proxyTemplate: proxy, skipMedia });
      return { result, name: websiteUrl.trim().replace(/^https?:\/\//i, '').replace(/\/$/, ''), label: websiteUrl.trim() };
    });

  async function removeProject(project: BrowserProject) {
    if (!window.confirm(`Delete "${project.name}" from this browser? Nothing on the source is touched.`)) return;
    try {
      await deleteBrowserProject(project.id);
      notify('success', 'Project deleted', project.name);
      setSelectedId('');
      await refresh();
    } catch (e) {
      notify('error', 'Delete failed', (e as Error).message);
    }
  }

  async function downloadZip() {
    if (!selected) return;
    setZipping(true);
    try {
      await downloadProjectZip(files, selected.name, (completed, total) =>
        setProgress({ phase: 'Zipping', completed, total }),
      );
      notify('success', 'Download ready', `${selected.name}.zip`);
    } catch (e) {
      notify('error', 'Download failed', (e as Error).message);
    } finally {
      setZipping(false);
      setProgress(null);
    }
  }

  const visibleFiles = searchBrowserFiles(files, query);
  const dupeGroups = duplicates ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
        >
          ← Workspace
        </Link>
        <h1 className="text-lg font-semibold text-slate-900">Browser Mode</h1>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          runs entirely in your browser
        </span>
      </div>

      <p className="text-sm text-slate-500">
        Import a local folder, a GitHub repository or a live website. Everything is fetched and stored{' '}
        <strong>in this browser</strong> (IndexedDB) — nothing is uploaded, the server is never used, and your data
        survives server restarts because it never left your machine.
      </p>

      {error && <ErrorBanner message={error} />}

      {busy && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
          <ProgressBar
            value={progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 4}
            label={`${progress?.phase ?? 'Working'}${progress?.detail ? ` — ${progress.detail}` : ''}`}
          />
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <form
          className="rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void importFolder();
          }}
        >
          <h2 className="font-medium text-slate-900">Local folder</h2>
          <p className="mt-1 text-xs text-slate-500">
            Reads the folder directly in your browser — the folder is only read, never modified.
          </p>
          {!canPickFolders && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              This browser cannot open folders directly. Use Chrome or Edge, or import from GitHub / a website.
            </p>
          )}
          <button
            type="submit"
            disabled={busy !== '' || !canPickFolders}
            className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {busy === 'folder' ? 'Reading…' : 'Choose folder & import'}
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
          <p className="mt-1 text-xs text-slate-500">
            Public repos only. Fetched straight from GitHub's API in your browser.
          </p>
          <input
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            placeholder="https://github.com/owner/repo"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            disabled={busy !== ''}
            required
          />
          <button
            type="submit"
            disabled={busy !== ''}
            className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {busy === 'github' ? 'Downloading…' : 'Import repository'}
          </button>
        </form>

        <form
          className="rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void importSite();
          }}
        >
          <h2 className="font-medium text-slate-900">Live website</h2>
          <p className="mt-1 text-xs text-slate-500">
            A browser cannot read another site directly, so pages are fetched through a CORS proxy.
          </p>
          <input
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            placeholder="https://example.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            disabled={busy !== ''}
            required
          />
          <label className="mt-2 block text-xs text-slate-500">
            Proxy template (<code className="font-mono">{'{url}'}</code> is replaced)
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-[11px]"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              disabled={busy !== ''}
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={skipMedia}
              onChange={(e) => setSkipMedia(e.target.checked)}
              disabled={busy !== ''}
              className="h-4 w-4"
            />
            Skip video/audio files
          </label>
          <button
            type="submit"
            disabled={busy !== ''}
            className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {busy === 'website' ? 'Crawling…' : 'Crawl & store in browser'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Browser projects ({projects?.length ?? 0})
        </h2>
        {projects === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : projects.length === 0 ? (
          <EmptyState
            title="Nothing stored in this browser yet"
            description="Import a folder, repository or website above — the project lives in this browser, so it stays available even when the server restarts."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className={`rounded-lg border bg-white p-4 transition ${
                  project.id === selectedId ? 'border-indigo-400 shadow-sm' : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="truncate text-left font-medium text-slate-900 hover:text-indigo-600"
                    onClick={() => setSelectedId(project.id)}
                    title={project.name}
                  >
                    {project.name}
                  </button>
                  <button
                    type="button"
                    title="Delete from this browser"
                    onClick={() => void removeProject(project)}
                    className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-400 transition hover:border-red-300 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-slate-500" title={project.sourceLabel}>
                  {project.sourceLabel}
                </div>
                <div className="mt-2 flex gap-2 text-xs text-slate-400">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{project.sourceType}</span>
                  <span>{project.fileCount} files</span>
                  <span>{formatBytes(project.totalSize)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Files" value={files.length} />
            <StatCard label="Folders" value={folderCount(files)} />
            <StatCard label="Total size" value={formatBytes(files.reduce((s, f) => s + f.size, 0))} />
            <StatCard
              label="Duplicate groups"
              value={duplicates === null ? '—' : dupeGroups.length}
              hint={duplicates === null ? 'Click “Find duplicates”' : undefined}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="Search paths, names, text…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              onClick={() => setDuplicates(browserDuplicates(files))}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Find duplicates
            </button>
            <button
              onClick={() => void downloadZip()}
              disabled={zipping || files.length === 0}
              className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {zipping ? 'Zipping…' : `Download all (ZIP) — ${files.length} files`}
            </button>
          </div>

          {duplicates !== null && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
              {dupeGroups.length === 0 ? (
                <span className="text-slate-500">No duplicates found — every file is unique.</span>
              ) : (
                <div className="space-y-1">
                  <strong className="text-slate-800">
                    {dupeGroups.length} duplicate group{dupeGroups.length === 1 ? '' : 's'}
                  </strong>
                  {dupeGroups.slice(0, 10).map((group) => (
                    <div key={group.hash} className="font-mono text-xs text-slate-500">
                      {group.files.map((f) => f.relativePath).join('  ·  ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Path</th>
                    <th className="px-4 py-2">Size</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map((file) => (
                    <tr key={file.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="flex items-center gap-2 px-4 py-1.5">
                        <FileIcon extension={file.extension} />
                        <span className="truncate font-mono text-xs text-slate-700" title={file.relativePath}>
                          {file.relativePath}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-xs text-slate-500">{formatBytes(file.size)}</td>
                      <td className="px-4 py-1.5 text-right">
                        <button
                          type="button"
                          title="Download this file"
                          onClick={() => downloadBlob(file.blob, file.name)}
                          className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
                        >
                          ↓
                        </button>
                      </td>
                    </tr>
                  ))}
                  {visibleFiles.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-400">
                        No files match that search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Imported {formatDate(selected.createdAt)} · stored in this browser only
          </p>
        </section>
      )}
    </div>
  );
}
