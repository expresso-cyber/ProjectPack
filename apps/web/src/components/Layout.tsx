import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

export default function Layout({ children }: { children: ReactNode }) {
  const { projectId } = useParams();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <img src="/logo.jpeg" alt="ProjectPack logo" className="h-8 w-8 rounded-lg object-cover" />
              ProjectPack
            </Link>
            <div className="flex items-center gap-2">
              <Link
                to="/browser"
                title="Import and store in this browser — no server needed"
                className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
              >
                Browser Mode
              </Link>
            </div>
            {projectId && (
              <nav className="flex flex-wrap gap-1 text-sm">
                <ProjectNavLink to={`/projects/${projectId}`}>Overview</ProjectNavLink>
                <ProjectNavLink to={`/projects/${projectId}/files`}>Files</ProjectNavLink>
                <ProjectNavLink to={`/projects/${projectId}/search`}>Search</ProjectNavLink>
                <ProjectNavLink to={`/projects/${projectId}/duplicates`}>Duplicates</ProjectNavLink>
                <ProjectNavLink to={`/projects/${projectId}/package`}>Package</ProjectNavLink>
                <ProjectNavLink to={`/projects/${projectId}/report`}>Report</ProjectNavLink>
                <ProjectNavLink to={`/projects/${projectId}/prompt`}>Prompt</ProjectNavLink>
              </nav>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}

function ProjectNavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-md px-3 py-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
    >
      {children}
    </Link>
  );
}
