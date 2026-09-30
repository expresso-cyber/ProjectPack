import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';

export interface Crumb {
  label: string;
  to?: string;
}

/** Minimal breadcrumb trail: Workspace / Project / Current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1">
          {item.to ? (
            <Link to={item.to} className="transition hover:text-indigo-600 hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-slate-400" aria-current={index === items.length - 1 ? 'page' : undefined}>
              {item.label}
            </span>
          )}
          {index < items.length - 1 && <span className="text-slate-300">/</span>}
        </span>
      ))}
    </nav>
  );
}

const nameCache = new Map<string, string>();

/** Resolves (and caches) the project name so breadcrumbs can use it. */
export function useProjectName(projectId: string): string {
  const [name, setName] = useState(nameCache.get(projectId) ?? '');
  useEffect(() => {
    const cached = nameCache.get(projectId);
    if (cached) {
      setName(cached);
      return;
    }
    let cancelled = false;
    api
      .getProject(projectId)
      .then((p) => {
        nameCache.set(projectId, p.name);
        if (!cancelled) setName(p.name);
      })
      .catch(() => {
        /* breadcrumb falls back to "Project" */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return name;
}

/** Standard breadcrumbs inside a project: Workspace / <project> / <page>. */
export function ProjectBreadcrumbs({ projectId, page }: { projectId: string; page?: string }) {
  const projectName = useProjectName(projectId) || 'Project';
  const items: Crumb[] = [
    { label: 'Workspace', to: '/' },
    { label: projectName, to: `/projects/${projectId}` },
  ];
  if (page) items.push({ label: page });
  return <Breadcrumbs items={items} />;
}
