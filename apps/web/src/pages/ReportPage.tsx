import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { ReportResponse } from '@projectpack/shared';
import { ErrorBanner, SkeletonCards, StatCard } from '../components/ui';
import { ProjectBreadcrumbs } from '../components/Breadcrumbs';
import { formatBytes } from '../lib/format';

export default function ReportPage() {
  const { projectId = '' } = useParams();
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getReport(projectId)
      .then(setReport)
      .catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <ErrorBanner message={error} />;
  if (!report) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={4} />
        <SkeletonCards count={2} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => window.history.back()}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
      >
        ← Back
      </button>

      <ProjectBreadcrumbs projectId={projectId} page="Report" />

      <h1 className="text-lg font-semibold text-slate-900">Analysis report</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Files" value={report.totals.files} />
        <StatCard label="Folders" value={report.totals.folders} />
        <StatCard label="Total size" value={formatBytes(report.totals.totalSize)} />
        <StatCard
          label="Extraction"
          value={`${report.totals.extracted}/${report.totals.supported}`}
          hint={`${report.totals.failed} failed · ${report.totals.unsupported} unsupported`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-medium text-slate-900">Findings</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>
              Duplicate groups: <strong>{report.duplicates.groups}</strong> (
              {formatBytes(report.duplicates.wastedBytes)} redundant)
            </li>
            <li>
              Empty folders: <strong>{report.emptyFolders.length}</strong>
            </li>
            <li>
              Deepest nesting: <strong>{report.deepestDepth}</strong> levels
            </li>
          </ul>
          {report.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-md bg-amber-50 p-3 text-xs text-amber-700">
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-medium text-slate-900">Largest files</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {report.largestFiles.map((f) => (
              <li key={f.relativePath} className="flex justify-between gap-3">
                <span className="truncate font-mono">{f.relativePath}</span>
                <span className="shrink-0 text-slate-400">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-900">
          File types
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Extension</th>
              <th className="px-4 py-2">Files</th>
              <th className="px-4 py-2">Size</th>
            </tr>
          </thead>
          <tbody>
            {report.extensionBreakdown.map((row) => (
              <tr key={row.extension} className="border-b border-slate-50">
                <td className="px-4 py-1.5 font-mono text-xs">{row.extension}</td>
                <td className="px-4 py-1.5">{row.count}</td>
                <td className="px-4 py-1.5 text-slate-500">{formatBytes(row.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
