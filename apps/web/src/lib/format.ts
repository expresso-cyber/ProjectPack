export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const EXTENSION_COLORS: Record<string, string> = {
  '.py': 'bg-sky-100 text-sky-700',
  '.js': 'bg-yellow-100 text-yellow-700',
  '.ts': 'bg-blue-100 text-blue-700',
  '.tsx': 'bg-blue-100 text-blue-700',
  '.jsx': 'bg-yellow-100 text-yellow-700',
  '.json': 'bg-amber-100 text-amber-700',
  '.md': 'bg-slate-200 text-slate-700',
  '.csv': 'bg-emerald-100 text-emerald-700',
  '.pdf': 'bg-red-100 text-red-700',
  '.docx': 'bg-indigo-100 text-indigo-700',
  '.xlsx': 'bg-green-100 text-green-700',
  '.pptx': 'bg-orange-100 text-orange-700',
  '.html': 'bg-orange-100 text-orange-700',
  '.css': 'bg-purple-100 text-purple-700',
};

export function extensionBadge(extension: string | undefined): string {
  if (!extension) return 'bg-slate-200 text-slate-600';
  return EXTENSION_COLORS[extension] ?? 'bg-slate-100 text-slate-600';
}

export function statusColor(status: string): string {
  switch (status) {
    case 'extracted':
      return 'text-emerald-600';
    case 'failed':
      return 'text-red-600';
    case 'skipped':
      return 'text-slate-400';
    default:
      return 'text-amber-600';
  }
}
