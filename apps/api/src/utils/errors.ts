/** Structured application errors mapped to the documented API error format. */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'INVALID_PROJECT_SOURCE'
  | 'UNSAFE_PATH'
  | 'JOB_FAILED'
  | 'GITHUB_ERROR'
  | 'WEBSITE_ERROR'
  | 'AI_ERROR'
  | 'ENGINE_ERROR'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export const notFound = (what: string): AppError =>
  new AppError('NOT_FOUND', `${what} not found`, 404);
