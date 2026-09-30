import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

/**
 * OPTIONAL AI prompt enhancement (ADR-007).
 *
 * The prompt generator itself stays fully deterministic. This module is the
 * single opt-in place where an LLM can be used: the user explicitly clicks
 * "Enhance with AI", a key must be configured via env (AI_API_KEY + optional
 * AI_BASE_URL / AI_MODEL — any OpenAI-compatible chat completions endpoint
 * works), and the deterministic prompt is always kept as the fallback.
 */

const MAX_PROMPT_CHARS = 600_000;

export function aiStatus(): { configured: boolean; model: string } {
  return { configured: Boolean(env.aiApiKey), model: env.aiModel };
}

export async function enhancePromptWithAi(prompt: string, projectName: string): Promise<string> {
  if (!env.aiApiKey) {
    throw new AppError(
      'AI_ERROR',
      'AI enhancement is not configured. Set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL) in .env, then restart the API.',
      503,
    );
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new AppError(
      'AI_ERROR',
      'The generated prompt is too large for AI enhancement — lower the per-file cap or export fewer files, then try again.',
      413,
    );
  }

  const body = {
    model: env.aiModel,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert prompt engineer for AI coding agents. You improve "recreate this project" prompts. ' +
          'Never remove or summarize the provided file contents — they are the source of truth. You may reorganize the ' +
          'sections, add a clear goal statement, a technology summary, ordering guidance, constraints, and a verification checklist. ' +
          'Return ONLY the improved prompt as markdown, with no commentary before or after.',
      },
      {
        role: 'user',
        content:
          `Improve the following project recreation prompt for the project "${projectName}". ` +
          `Add: (1) a short goal section stating the aim is to rebuild this ${'project so it works exactly like the original'}; ` +
          `(2) a tech-stack summary inferred from the file list; (3) a final verification checklist. Keep every file content block intact.\n\n${prompt}`,
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch(`${env.aiBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.aiApiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new AppError(
      'AI_ERROR',
      `Could not reach the AI provider (${err instanceof Error ? err.message : 'network error'})`,
      502,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AppError('AI_ERROR', `AI provider returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`, 502);
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new AppError('AI_ERROR', 'The AI provider returned an empty response', 502);
  }
  return text;
}
