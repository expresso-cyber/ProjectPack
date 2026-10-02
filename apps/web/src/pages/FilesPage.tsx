import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiUrl } from '../services/api';
import type { FolderNode, FileRecord } from '@projectpack/shared';
import { EmptyState, ErrorBanner, Skeleton, SkeletonRows } from '../components/ui';
import { FileIcon } from '../components/ui';
import { ProjectBreadcrumbs } from '../components/Breadcrumbs';
import { useToast } from '../components/Toast';
import { downloadFromUrl } from '../lib/download';
import { formatBytes, statusColor } from '../lib/format';

export default function FilesPage() {
  const { projectId = '' } = useParams();
  const [root, setRoot] = useState<FolderNode | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [supportedOnly, setSupportedOnly] = useState(false);

  useEffect(() => {
    api
      .getTree(projectId)
      .then((res) => setRoot(res.root))
      .catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <ErrorBanner message={error} />;
  if (!root) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <SkeletonRows count={8} />
      </div>
    );
  }

  const needle = filter.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <button
        onClick={() => window.history.back()}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
      >
        ← Back
      </button>

      <ProjectBreadcrumbs projectId={projectId} page="Files" />

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">File tree</h1>
        <input
          className="ml-auto w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Filter by path or name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={supportedOnly}
            onChange={(e) => setSupportedOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Supported only
        </label>
      </div>

      {countFiles(root) === 0 ? (
        <EmptyState
          title="No files scanned yet"
          description="Run a scan from the project overview first — the file tree appears here once the project is indexed."
          action={
            <Link
              to={`/projects/${projectId}`}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Go to overview
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <FolderRow
            node={root}
            depth={0}
            needle={needle}
            supportedOnly={supportedOnly}
            projectId={projectId}
          />
        </div>
      )}
    </div>
  );
}

function countFiles(node: FolderNode): number {
  return (
    node.files.length + node.folders.reduce((sum: number, f) => sum + countFiles(f as FolderNode), 0)
  );
}

function matches(f: FileRecord, needle: string, supportedOnly: boolean): boolean {
  if (supportedOnly && !f.isSupported) return false;
  if (!needle) return true;
  return f.relativePath.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle);
}

function FolderRow({
  node,
  depth,
  needle,
  supportedOnly,
  projectId,
}: {
  node: FolderNode;
  depth: number;
  needle: string;
  supportedOnly: boolean;
  projectId: string;
}) {
  const [open, setOpen] = useState(depth < 2);
  const { notify } = useToast();
  const [downloading, setDownloading] = useState(false);
  const folders = node.folders as FolderNode[];
  const files = node.files.filter((f) => matches(f, needle, supportedOnly));
  const hasVisibleChildren =
    files.length > 0 ||
    folders.some((folder) => folderHasMatch(folder, needle, supportedOnly));

  if (needle && !hasVisibleChildren) return null;

  async function downloadFolder() {
    setDownloading(true);
    try {
      const name = await downloadFromUrl(
        apiUrl(`/api/projects/${projectId}/folder/download?path=${encodeURIComponent(node.relativePath)}`),
        `${node.name}.zip`,
      );
      notify('success', 'Download complete', `${name} — everything under ${node.name}`);
    } catch (e) {
      console.error('[ProjectPack] Folder download failed:', e);
      notify('error', 'Download failed', (e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function downloadFile(file: FileRecord) {
    try {
      const name = await downloadFromUrl(
        apiUrl(`/api/projects/${projectId}/files/${file.id}/raw?download=1`),
        file.name,
      );
      notify('success', 'Download complete', name);
    } catch (e) {
      console.error('[ProjectPack] File download failed:', e);
      notify('error', 'Download failed', (e as Error).message);
    }
  }

  return (
    <div>
      {depth > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setOpen(!open);
          }}
          className="flex w-full cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
          style={{ paddingLeft: depth * 16 + 12 }}
        >
          <span className="text-slate-400">{open ? '▾' : '▸'}</span>
          <span className="font-medium text-slate-700">{node.name}</span>
          <span className="text-xs text-slate-400">
            {folders.length} folders · {node.files.length} files
          </span>
          <button
            type="button"
            title="Download this folder as a ZIP"
            disabled={downloading}
            onClick={(e) => {
              e.stopPropagation();
              void downloadFolder();
            }}
            className="ml-auto rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
          >
            {downloading ? 'Zipping…' : '↓ ZIP'}
          </button>
        </div>
      )}
      {(open || needle) && (
        <>
          {folders.map((folder) => (
            <FolderRow
              key={folder.relativePath}
              node={folder}
              depth={depth + 1}
              needle={needle}
              supportedOnly={supportedOnly}
              projectId={projectId}
            />
          ))}
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 border-b border-slate-50 px-3 py-1.5 text-sm hover:bg-indigo-50/50"
              style={{ paddingLeft: (depth + 1) * 16 + 12 }}
            >
              <FileIcon extension={file.extension} />
              <Link
                to={`/projects/${projectId}/files/${file.id}`}
                className="flex-1 truncate text-slate-700"
                title={file.relativePath}
              >
                {file.name}
              </Link>
              <span className="text-xs text-slate-400">{formatBytes(file.size)}</span>
              <span className={`w-16 text-right text-xs ${statusColor(file.extractionStatus)}`}>
                {file.extractionStatus}
              </span>
              <button
                type="button"
                title="Download this file"
                onClick={() => void downloadFile(file)}
                className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
              >
                ↓
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function folderHasMatch(node: FolderNode, needle: string, supportedOnly: boolean): boolean {
  if (!needle && !supportedOnly) return true;
  return (
    node.files.some((f) => matches(f, needle, supportedOnly)) ||
    (node.folders as FolderNode[]).some((f) => folderHasMatch(f, needle, supportedOnly))
  );
}
