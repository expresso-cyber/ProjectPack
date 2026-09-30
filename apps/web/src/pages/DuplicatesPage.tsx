import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { DuplicateFile } from '../services/api';
import { EmptyState, ErrorBanner, FileIcon, SkeletonCards, StatCard } from '../components/ui';
import { ProjectBreadcrumbs } from '../components/Breadcrumbs';
import { formatBytes, formatDate } from '../lib/format';

interface Group {
  hash: string;
  totalBytes: number;
  files: DuplicateFile[];
}

export default function DuplicatesPage() {
  const { projectId = '' } = useParams();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .duplicates(projectId)
      .then((res) => setGroups(res.groups))
      .catch((e) => setError(e.message));
  }, [projectId]);

  useEffect(load, [load]);

  async function analyze() {
    setBusy(true);
    setError('');
    try {
      await api.analyzeDuplicates(projectId);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const wasted = (groups ?? []).reduce(
    (sum, g) => sum + (g.files.slice(1).reduce((s, f) => s + f.size, 0)),
    0,
  );

  return (
    <div className="space-y-4">
      <button
        onClick={() => window.history.back()}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
      >
        ← Back
      </button>

      <ProjectBreadcrumbs projectId={projectId} page="Duplicates" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">Duplicate center</h1>
        <button
          onClick={() => void analyze()}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Analyzing…' : 'Run duplicate analysis'}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {groups === null ? (
        <SkeletonCards count={2} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Duplicate groups" value={groups.length} />
            <StatCard label="Wasted bytes" value={formatBytes(wasted)} hint="Size of redundant copies" />
          </div>

          {groups.length === 0 ? (
            <EmptyState
              title="No duplicate groups"
              description="Either no two files share identical content (by SHA-256), or duplicate analysis has not been run yet. Click “Run duplicate analysis” after scanning."
            />
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.hash} className="rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                    <span className="font-mono text-xs text-slate-500">
                      sha256 {group.hash.slice(0, 16)}…
                    </span>
                    <span className="text-xs text-slate-500">
                      {group.files.length} copies · {formatBytes(group.totalBytes)} total
                    </span>
                  </div>
                  <ul>
                    {group.files.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center gap-3 border-b border-slate-50 px-4 py-2 text-sm last:border-0"
                      >
                        <FileIcon extension={f.relativePath.slice(f.relativePath.lastIndexOf('.'))} />
                        <span className="flex-1 truncate font-mono text-xs">{f.relativePath}</span>
                        <span className="text-xs text-slate-400">{formatBytes(f.size)}</span>
                        <span className="text-xs text-slate-400">{formatDate(f.modifiedAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
