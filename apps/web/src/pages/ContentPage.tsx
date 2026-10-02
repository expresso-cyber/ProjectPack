import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiUrl } from '../services/api';
import type { ContentResponse } from '@projectpack/shared';
import { ErrorBanner, FileIcon, Skeleton } from '../components/ui';
import { ProjectBreadcrumbs } from '../components/Breadcrumbs';

export default function ContentPage() {
  const { projectId = '', fileId = '' } = useParams();
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [error, setError] = useState('');
  const [archive, setArchive] = useState<{
    entries: { name: string; size: number; compressedSize: number; isDir: boolean }[];
    truncated: boolean;
    totalUncompressedSize: number;
  } | null>(null);

  const isZip = content?.relativePath.toLowerCase().endsWith('.zip');

  useEffect(() => {
    api
      .getContent(projectId, fileId)
      .then(async (c) => {
        setContent(c);
        if (c.relativePath.toLowerCase().endsWith('.zip')) {
          try {
            const listing = await fetch(apiUrl(`/api/projects/${projectId}/files/${fileId}/archive`)).then((r) => r.json());
            if (listing.ok) setArchive(listing);
          } catch {
            /* archive listing is best-effort */
          }
        }
      })
      .catch((e) => setError(e.message));
  }, [projectId, fileId]);

  if (error) return <ErrorBanner message={error} />;
  if (!content) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-72" />
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
      </div>
    );
  }

  const extension = content.relativePath.slice(content.relativePath.lastIndexOf('.'));

  return (
    <div className="space-y-4">
      <button
        onClick={() => window.history.back()}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
      >
        ← Back
      </button>

      <ProjectBreadcrumbs projectId={projectId} page="File content" />

      <div className="flex items-center gap-3">
        <FileIcon extension={extension} />
        <div className="min-w-0">
          <h1 className="truncate font-mono text-sm font-medium text-slate-900">{content.relativePath}</h1>
          <div className="text-xs text-slate-500">
            {[
              content.wordCount != null ? `${content.wordCount} words` : null,
              content.lineCount != null ? `${content.lineCount} lines` : null,
              content.pageCount ? `${content.pageCount} pages` : null,
              content.sheetCount ? `${content.sheetCount} sheets` : null,
              content.slideCount ? `${content.slideCount} slides` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <Link
          to={`/projects/${projectId}/files`}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          Back to tree
        </Link>
      </div>

      {content.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          {content.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <pre className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
        {content.text || '(no content)'}
      </pre>

      {isZip && archive && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            <span>Archive contents ({archive.entries.filter((e) => !e.isDir).length} files) — inspected without extracting</span>
            {archive.truncated && <span className="text-amber-600">listing truncated</span>}
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2">Compressed</th>
              </tr>
            </thead>
            <tbody>
              {archive.entries.map((e) => (
                <tr key={e.name} className="border-b border-slate-50">
                  <td className="px-4 py-1.5 font-mono">{e.name}</td>
                  <td className="px-4 py-1.5">{e.size} B</td>
                  <td className="px-4 py-1.5 text-slate-500">{e.compressedSize} B</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
