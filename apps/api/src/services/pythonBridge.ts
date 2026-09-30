import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Bridge to the Python file engine. Payloads travel through temp files so
 * neither argv limits nor stdout buffering constrain large results.
 */

export type EngineCommand =
  | 'scan'
  | 'extract'
  | 'hash'
  | 'analyze'
  | 'package'
  | 'export'
  | 'unpack'
  | 'inspect-archive';

export interface RunOptions {
  source?: string;
  files?: unknown[];
  folders?: unknown[];
  entries?: unknown[];
  dest?: string;
  format?: 'txt' | 'md' | 'json';
  name?: string;
  archive?: string;
  maxFiles?: number;
  exclude?: string[];
}

function engineTmp(): string {
  const dir = path.join(env.dataDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeInput(value: unknown[]): string {
  const file = path.join(engineTmp(), `${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

/**
 * Resolve the Python interpreter once. On Windows "python3" usually does not
 * exist (the launcher is "python" or "py"), so we probe candidates and cache
 * the first one that responds. An explicit PYTHON_BIN is always honored.
 */
function pythonCommand(): { bin: string; prefix: string[] } {
  if (resolvedCommand) return resolvedCommand;
  const candidates: Array<{ bin: string; prefix: string[] }> =
    env.pythonBin === 'python3'
      ? [
          { bin: 'python3', prefix: [] },
          { bin: 'python', prefix: [] },
          { bin: 'py', prefix: ['-3'] },
        ]
      : [{ bin: env.pythonBin, prefix: [] }];
  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate.bin, [...candidate.prefix, '--version'], {
        timeout: 10_000,
      });
      if (probe.status === 0) {
        resolvedCommand = candidate;
        logger.info(`File engine interpreter: ${candidate.bin} ${candidate.prefix.join(' ')}`.trim());
        return candidate;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new AppError(
    'ENGINE_ERROR',
    `No Python interpreter found (tried: ${candidates.map((c) => c.bin).join(', ')}). ` +
      'Install Python 3.12+ and make sure it is on PATH, or set PYTHON_BIN in .env.',
    500,
  );
}
let resolvedCommand: { bin: string; prefix: string[] } | null = null;

function runProcess(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const python = pythonCommand();
  return new Promise((resolve) => {
    const child = spawn(python.bin, [...python.prefix, ...args], {
      cwd: path.dirname(env.enginePath),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function toAppError(cmd: string, code: number, stdout: string, stderr: string): AppError {
  logger.error({ cmd, code, stdout, stderr }, 'file engine command failed');
  let message = `File engine command "${cmd}" failed (exit ${code})`;
  let engineCode = 'ENGINE_ERROR';
  let status = 500;
  try {
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    if (parsed.message) message = parsed.message;
    if (parsed.code === 'UNSAFE_PATH') {
      engineCode = 'UNSAFE_PATH';
      status = 400;
    }
    if (parsed.code === 'BAD_INPUT') {
      engineCode = 'VALIDATION_ERROR';
      status = 400;
    }
  } catch {
    /* stdout was not JSON — keep default message */
  }
  return new AppError(engineCode as never, message, status);
}

/** Run an engine command whose result is a JSON document written to --out. */
export async function runEngine<T>(cmd: EngineCommand, options: RunOptions): Promise<T> {
  const out = path.join(engineTmp(), `${crypto.randomUUID()}.json`);
  const args: string[] = ['-m', 'file_engine.worker', cmd];
  if (options.source !== undefined) args.push('--source', options.source);
  if (options.files !== undefined) args.push('--files', writeInput(options.files));
  if (options.folders !== undefined) args.push('--folders', writeInput(options.folders));
  if (options.entries !== undefined) args.push('--entries', writeInput(options.entries));
  if (options.dest !== undefined) args.push('--dest', options.dest);
  if (options.name !== undefined) args.push('--name', options.name);
  if (options.archive !== undefined) args.push('--archive', options.archive);
  if (options.maxFiles !== undefined) args.push('--max-files', String(options.maxFiles));
  if (options.exclude?.length) args.push('--exclude', options.exclude.join(','));
  args.push('--out', out);

  const { code, stdout, stderr } = await runProcess(args);
  if (code !== 0) throw toAppError(cmd, code, stdout, stderr);
  return JSON.parse(fs.readFileSync(out, 'utf8')) as T;
}

/** Run the export command; the artifact lands at outPath, a .meta.json beside it. */
export async function runEngineExport(options: {
  entries: unknown[];
  format: 'txt' | 'md' | 'json';
  name: string;
  outPath: string;
}): Promise<{ bytes: number }> {
  const args = [
    '-m', 'file_engine.worker', 'export',
    '--entries', writeInput(options.entries),
    '--format', options.format,
    '--name', options.name,
    '--out', options.outPath,
  ];
  const { code, stdout, stderr } = await runProcess(args);
  if (code !== 0) throw toAppError('export', code, stdout, stderr);
  const meta = JSON.parse(fs.readFileSync(`${options.outPath}.meta.json`, 'utf8')) as { bytes: number };
  return meta;
}
