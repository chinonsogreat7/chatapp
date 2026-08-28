import { ApiRequestError } from '../api';
import type { ApiErrorBody } from './types';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const body = error.payload as ApiErrorBody | null;
    const retryAfter = readRetryAfter(body?.details);
    return retryAfter
      ? `${error.message} Try again in ${retryAfter} seconds.`
      : error.message;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return 'The server took too long to respond. Please try again.';
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const body = error.payload as ApiErrorBody | null;
  return typeof body?.code === 'string' ? body.code : null;
}

function readRetryAfter(details: unknown): number | null {
  if (
    typeof details === 'object' &&
    details !== null &&
    'retryAfterSeconds' in details &&
    typeof details.retryAfterSeconds === 'number'
  ) {
    return Math.max(1, Math.ceil(details.retryAfterSeconds));
  }
  return null;
}
