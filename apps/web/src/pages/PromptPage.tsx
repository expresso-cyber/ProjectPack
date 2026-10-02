import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, apiUrl, promptApi, aiApi } from '../services/api';
import type { ImageInfo } from '@projectpack/shared';
import { ErrorBanner, Skeleton } from '../components/ui';
import { ProjectBreadcrumbs } from '../components/Breadcrumbs';
import { useToast } from '../components/Toast';
import { downloadFromUrl, downloadText } from '../lib/download';
import { formatBytes } from '../lib/format';

export default function PromptPage() {
  const { projectId = '' } = useParams();
  const { notify } = useToast();
  const [includeContent, setIncludeContent] = useState(true);
  const [maxKb, setMaxKb] = useState('20');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedBy, setEnhancedBy] = useState<'deterministic' | 'ai'>('deterministic');
  const [error, setError] = useState('');
  const [images, setImages] = useState<ImageInfo[] | null>(null);
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  const [aiConfigured, setAiConfigured] = useState(false);
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    api
      .listImages(projectId)
      .then((res) => setImages(res.images))
      .catch(() => setImages([]));
    aiApi
      .status()
      .then((s) => setAiConfigured(s.configured))
      .catch(() => setAiConfigured(false));
  }, [projectId]);

  async function generate() {
    setBusy(true);
    setError('');
    setEnhancedBy('deterministic');
    try {
      const result = await promptApi.generate(
        projectId,
        includeContent,
        Math.max(1, Number.parseInt(maxKb, 10) || 20),
      );
      setPrompt(result.prompt);
      setFileCount(result.fileCount);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function enhance() {
    if (!prompt) return;
    setEnhancing(true);
    setError('');
    try {
      const result = await aiApi.enhance(projectId, prompt);
      setPrompt(result.prompt);
      setEnhancedBy('ai');
      notify('info', 'Prompt enhanced by AI', `Model: ${result.model}`);
    } catch (e) {
      setError((e as Error).message);
      notify('error', 'AI enhancement failed', (e as Error).message);
    } finally {
      setEnhancing(false);
    }
  }

  async function copy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      notify('success', 'Copied to clipboard', 'The prompt is ready to paste into your AI.');
    } catch {
      setError('Clipboard unavailable — select the text and copy manually.');
    }
  }

  function download() {
    if (!prompt) return;
    const name = downloadText(prompt, 'project-recreation-prompt.md', 'text/markdown');
    notify('success', 'Download complete', name);
  }

  async function downloadImage(image: ImageInfo) {
    setDownloading(image.fileId);
    try {
      const name = await downloadFromUrl(apiUrl(image.downloadUrl), image.name);
      notify('success', 'Download complete', name);
    } catch (e) {
      notify('error', 'Image download failed', (e as Error).message);
    } finally {
      setDownloading('');
    }
  }

  async function downloadAllImages() {
    setDownloading('__all__');
    try {
      const name = await downloadFromUrl(api.imagesZipUrl(projectId), 'project-images.zip');
      notify('success', 'Download complete', `${name} — all images from this project`);
    } catch (e) {
      notify('error', 'Image export failed', (e as Error).message);
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

      <ProjectBreadcrumbs projectId={projectId} page="Prompt" />

      <div>
        <h1 className="text-lg font-semibold text-slate-900">Generate project prompt</h1>
        <p className="mt-1 text-sm text-slate-500">
          Builds a professional “recreate this project” prompt from the scan and extracted content. Copy it
          into ChatGPT, Claude, Codex, or any coding agent and it will rebuild the project.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      {images && images.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-slate-900">
                Images <span className="text-slate-400">({images.length})</span>
              </h2>
              <p className="text-xs text-slate-500">
                Download any image (or all of them as a ZIP) before generating the prompt — the prompt tells
                the AI to reference these files, not recreate them.
              </p>
            </div>
            <button
              onClick={() => void downloadAllImages()}
              disabled={downloading === '__all__'}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {downloading === '__all__' ? 'Preparing ZIP…' : 'Download all (.zip)'}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image) => (
              <div key={image.fileId} className="rounded-lg border border-slate-200 p-2">
                <div className="grid h-28 place-items-center overflow-hidden rounded bg-slate-50">
                  {brokenThumbs.has(image.fileId) ? (
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {image.extension.replace('.', '') || 'file'}
                    </span>
                  ) : (
                    <img
                      src={api.rawFileUrl(projectId, image.fileId)}
                      alt={image.alt ?? image.name}
                      title={image.sourceUrl ?? image.relativePath}
                      loading="lazy"
                      className="max-h-28 max-w-full object-contain"
                      onError={() =>
                        setBrokenThumbs((prev) => new Set(prev).add(image.fileId))
                      }
                    />
                  )}
                </div>
                <p className="mt-2 truncate font-mono text-[11px] text-slate-600" title={image.relativePath}>
                  {image.name}
                </p>
                <p className="text-[11px] text-slate-400">
                  {formatBytes(image.size)}
                  {image.width && image.height ? ` · ${image.width}×${image.height}` : ''}
                </p>
                <button
                  onClick={() => void downloadImage(image)}
                  disabled={downloading === image.fileId}
                  className="mt-1.5 w-full rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {downloading === image.fileId ? 'Downloading…' : 'Download'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeContent}
              onChange={(e) => setIncludeContent(e.target.checked)}
              className="h-4 w-4"
            />
            Include file contents
          </label>
          <label className="text-xs text-slate-600">
            Max KB per file
            <input
              className="ml-2 w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              inputMode="numeric"
              value={maxKb}
              onChange={(e) => setMaxKb(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Generating…' : 'Generate prompt'}
          </button>
          {aiConfigured && prompt && (
            <button
              onClick={() => void enhance()}
              disabled={enhancing}
              className="rounded-md border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50"
              title="Optional: refine the generated prompt with a configured AI provider"
            >
              {enhancing ? 'Enhancing…' : 'Enhance with AI'}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Tip: for large projects, uncheck “include file contents” for a structure-only prompt, or lower the per-file
          cap to keep it within your AI’s context window.
        </p>
        {!aiConfigured && (
          <p className="mt-1 text-xs text-slate-400">
            Optional: set <span className="font-mono">AI_API_KEY</span> in the API’s{' '}
            <span className="font-mono">.env</span> to enable one-click AI prompt enhancement.
          </p>
        )}
      </div>

      {busy && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {prompt && !busy && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <span className="text-xs text-slate-500">
              {fileCount} file{fileCount === 1 ? '' : 's'} included ·{' '}
              {(prompt.length / 1024).toFixed(1)} KB
              {enhancedBy === 'ai' ? ' · enhanced by AI' : ''}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => void copy()}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
              >
                Copy to clipboard
              </button>
              <button
                onClick={download}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Download .md
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={prompt}
            className="h-[60vh] w-full resize-none rounded-b-lg p-4 font-mono text-xs leading-relaxed text-slate-800 focus:outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}
