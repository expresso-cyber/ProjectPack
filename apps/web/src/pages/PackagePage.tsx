import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { PackageOptions } from '../services/api';
import type { PackageManifest, PackagePreview, PackagePreviewPlanEntry } from '@projectpack/shared';
import { EmptyState, ErrorBanner, Spinner, StatCard } from '../components/ui';
import { ProjectBreadcrumbs } from '../components/Breadcrumbs';
import { useToast } from '../components/Toast';
import { downloadFromUrl } from '../lib/download';
import { formatBytes, formatDate } from '../lib/format';

const DEFAULT_OPTIONS: PackageOptions = {
  excludeUnsupported: true,
  excludeDuplicates: true,
  excludePatterns: [],
  maxFileBytes: 100 * 1024 * 1024,
};

/** Group preview entries by top-level path segment (site section / domain). */
function groupEntries(entries: PackagePreviewPlanEntry[]): Map<string, PackagePreviewPlanEntry[]> {
  const groups = new Map<string, PackagePreviewPlanEntry[]>();
  for (const entry of entries) {
    const key = entry.path.includes('/') ? entry.path.split('/')[0] : '(root files)';
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

export default function PackagePage() {
  const { projectId = '' } = useParams();
  const { notify } = useToast();
  const [options, setOptions] = useState<PackageOptions>(DEFAULT_OPTIONS);
  const [preview, setPreview] = useState<PackagePreview | null>(null);
  const [packages, setPackages] = useState<PackageManifest[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [downloading, setDownloading] = useState('');
  // the user's checkbox selection — everything is selected by default (full
  // clone); unchecking trims the package to exactly the checked files/folders
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadPackages = useCallback(() => {
    api
      .getPackages(projectId)
      .then((res) => setPackages(res.packages))
      .catch(() => setPackages([]));
  }, [projectId]);

  useEffect(loadPackages, [loadPackages]);

  async function refreshPreview(next: PackageOptions) {
    setOptions(next);
    setBusy('preview');
    setError('');
    try {
      const nextPreview = await api.previewPackage(projectId, next);
      setPreview(nextPreview);
      // fresh preview → select everything that passes the exclusion rules
      setSelected(
        new Set(nextPreview.entries.filter((e) => e.included).map((e) => e.path)),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    void refreshPreview(DEFAULT_OPTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // entries that pass the exclusion rules (selectable); selection trims these
  const selectable = useMemo(
    () => new Set((preview?.entries ?? []).filter((e) => e.included).map((e) => e.path)),
    [preview],
  );
  const groups = useMemo(
    () => [...groupEntries(preview?.entries ?? []).entries()],
    [preview],
  );
  const selectedEntries = useMemo(
    () => (preview?.entries ?? []).filter((e) => selectable.has(e.path) && selected.has(e.path)),
    [preview, selectable, selected],
  );
  const selectedCount = selectedEntries.length;
  const selectedSize = selectedEntries.reduce((sum, e) => sum + e.size, 0);

  function togglePath(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleGroup(entries: PackagePreviewPlanEntry[]) {
    const groupPaths = entries.filter((e) => selectable.has(e.path)).map((e) => e.path);
    const allSelected = groupPaths.every((p) => selected.has(p));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of groupPaths) {
        if (allSelected) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  }

  async function createPackage() {
    if (
      !window.confirm(
        `Create a ProjectPack with ${selectedCount} files (${formatBytes(selectedSize)})? ` +
          'Files are copied into a new package — sources are never modified.',
      )
    ) {
      return;
    }
    setBusy('create');
    setError('');
    try {
      await api.createPackage(projectId, {
        ...options,
        includePaths: [...selected],
      });
      loadPackages();
      notify('success', 'Package created', `${selectedCount} files included`);
    } catch (e) {
      console.error('[ProjectPack] Package creation failed:', e);
      notify('error', 'Package creation failed', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function downloadPackage(pkg: PackageManifest) {
    setDownloading(pkg.packageId);
    try {
      const name = await downloadFromUrl(
        apiUrl(`/api/projects/${projectId}/package/${pkg.packageId}/download`),
        `${pkg.packageId}.zip`,
      );
      notify('success', 'Download complete', `${name} — ${pkg.fileCount} files`);
    } catch (e) {
      notify('error', 'Download failed', (e as Error).message);
    } finally {
      setDownloading('');
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => window.history.back()}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
      >
        ← Back
      </button>

      <ProjectBreadcrumbs projectId={projectId} page="Package" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">ProjectPack</h1>
        <div className="flex items-center gap-3">
          {preview && (
            <span className="text-xs text-slate-500">
              {selectedCount} of {selectable.size} files selected · {formatBytes(selectedSize)}
            </span>
          )}
          <button
            onClick={() => void createPackage()}
            disabled={!preview || busy !== '' || selectedCount === 0}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === 'create' ? 'Creating…' : 'Approve & create package'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">Exclusion rules</h2>
        <p className="text-xs text-slate-500">
          Nothing is written until you approve the preview below. Sources are never modified.
        </p>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.excludeUnsupported}
              onChange={(e) => void refreshPreview({ ...options, excludeUnsupported: e.target.checked })}
              className="h-4 w-4"
            />
            Exclude unsupported file types
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.excludeDuplicates}
              onChange={(e) => void refreshPreview({ ...options, excludeDuplicates: e.target.checked })}
              className="h-4 w-4"
            />
            Exclude duplicate copies (keeps the newest of each group)
          </label>
          <label className="flex items-center gap-2">
            Pattern
            <input
              className="w-64 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
              placeholder="regex, e.g. \.log$"
              value={options.excludePatterns.join(', ')}
              onChange={(e) =>
                void refreshPreview({
                  ...options,
                  excludePatterns: e.target.value
                    .split(',')
                    .map((p) => p.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      </div>

      {busy === 'preview' && <Spinner label="Building preview…" />}

      <p className="text-xs text-slate-500">
        Uncheck files or whole folders below to package only part of the site — the package (your
        clone) will contain exactly the checked items.
      </p>

      {preview && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Selected for package" value={selectedCount} />
            <StatCard label="Unselected / excluded" value={preview.entries.length - selectedCount} />
            <StatCard label="Package size" value={formatBytes(selectedSize)} />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all files"
                      checked={selectedCount === selectable.size && selectable.size > 0}
                      onChange={() =>
                        setSelected(
                          selectedCount === selectable.size ? new Set() : new Set(selectable),
                        )
                      }
                      className="h-4 w-4"
                    />
                  </th>
                  <th className="px-4 py-2">Path</th>
                  <th className="px-4 py-2">Size</th>
                  <th className="px-4 py-2">Decision</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([group, entries]) => {
                  const groupPaths = entries
                    .filter((e) => selectable.has(e.path))
                    .map((e) => e.path);
                  const allSelected =
                    groupPaths.length > 0 && groupPaths.every((p) => selected.has(p));
                  return (
                    <Fragment key={group}>
                      <tr className="border-b border-slate-200 bg-slate-50/60">
                        <td colSpan={4} className="px-4 py-1.5">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={() => toggleGroup(entries)}
                              className="h-4 w-4"
                            />
                            <span className="font-mono text-xs font-semibold text-slate-700">
                              {group}
                            </span>
                            <span className="text-xs text-slate-400">{groupPaths.length} files</span>
                          </label>
                        </td>
                      </tr>
                      {entries.map((entry) => {
                        const isSelectable = selectable.has(entry.path);
                        const isSelected = selected.has(entry.path);
                        const decision = !isSelectable
                          ? entry.reason
                          : isSelected
                            ? 'Included'
                            : 'Not selected';
                        return (
                          <tr
                            key={entry.path}
                            className={`border-b border-slate-50 ${
                              isSelectable && isSelected ? '' : 'text-slate-400'
                            }`}
                          >
                            <td className="px-4 py-1.5">
                              {isSelectable ? (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => togglePath(entry.path)}
                                  className="h-4 w-4"
                                />
                              ) : (
                                <span className="block h-4 w-4" />
                              )}
                            </td>
                            <td className="px-4 py-1.5 font-mono text-xs">{entry.path}</td>
                            <td className="px-4 py-1.5 text-xs">{formatBytes(entry.size)}</td>
                            <td className="px-4 py-1.5 text-xs">
                              <span
                                className={`rounded-full px-2 py-0.5 ${
                                  isSelectable && isSelected
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}
                              >
                                {decision}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Created packages</h2>
        {packages.length === 0 ? (
          <EmptyState
            title="No packages yet"
            description="Approve the preview above to create your first package. Each package includes a SHA-256 manifest."
          />
        ) : (
          <div className="space-y-2">
            {packages.map((pkg) => (
              <div
                key={pkg.packageId}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                <span className="font-mono text-xs text-slate-600">{pkg.packageId}</span>
                <span className="text-xs text-slate-400">
                  {pkg.fileCount} files · {formatBytes(pkg.totalSize ?? 0)} · {formatDate(pkg.createdAt)}
                </span>
                <div className="ml-auto flex gap-2">
                  <a
                    href={apiUrl(`/api/projects/${projectId}/package/${pkg.packageId}/manifest`)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Manifest
                  </a>
                  <button
                    onClick={() => void downloadPackage(pkg)}
                    disabled={downloading === pkg.packageId}
                    className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                  >
                    {downloading === pkg.packageId ? 'Downloading…' : 'Download ZIP'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
