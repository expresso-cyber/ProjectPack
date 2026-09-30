import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { SearchHit } from '@projectpack/shared';
import { EmptyState, FileIcon, Spinner } from '../components/ui';
import { ProjectBreadcrumbs } from '../components/Breadcrumbs';

export default function SearchPage() {
  const { projectId = '' } = useParams();
  const [query, setQuery] = useState('');
  const [inContent, setInContent] = useState(true);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const result = await api.search(projectId, query, inContent);
      setHits(result.hits);
      setTotal(result.total);
    } finally {
      setBusy(false);
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

      <ProjectBreadcrumbs projectId={projectId} page="Search" />

      <h1 className="text-lg font-semibold text-slate-900">Search</h1>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search file names, paths, or extracted content…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={inContent}
            onChange={(e) => setInContent(e.target.checked)}
            className="h-4 w-4"
          />
          In content
        </label>
        <button
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={busy}
        >
          Search
        </button>
      </form>

      {busy && <Spinner label="Searching…" />}

      {hits !== null && (
        <p className="text-sm text-slate-500">
          {total} match{total === 1 ? '' : 'es'} for “{query}”
        </p>
      )}

      {hits !== null && hits.length === 0 && (
        <EmptyState
          title="No matches"
          description="Nothing matched this query. Try a shorter term, or enable content search after running extraction."
        />
      )}

      {hits?.map((hit) => (
        <Link
          key={hit.fileId}
          to={`/projects/${projectId}/files/${hit.fileId}`}
          className="block rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-300"
        >
          <div className="flex items-center gap-3">
            <FileIcon extension={hit.relativePath.slice(hit.relativePath.lastIndexOf('.'))} />
            <span className="font-mono text-xs text-slate-700">{hit.relativePath}</span>
            <span className="ml-auto text-xs text-slate-400">{hit.matches} match(es)</span>
          </div>
          {hit.snippet && <p className="mt-2 truncate text-xs text-slate-500">{hit.snippet}</p>}
        </Link>
      ))}
    </div>
  );
}
