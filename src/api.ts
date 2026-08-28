export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(readApiErrorMessage(status, payload));
    this.name = 'ApiRequestError';
  }
}

export interface ApiRequestOptions {
  origin: string;
  accessToken?: string | null;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function normalizeApiOrigin(value: string): string {
  let origin = value.trim().replace(/\/+$/, '');

  if (origin.endsWith('/v1')) origin = origin.slice(0, -3);
  if (origin.endsWith('/chat')) origin = origin.slice(0, -5);

  if (!/^https?:\/\//i.test(origin)) {
    throw new Error('API origin must begin with http:// or https://.');
  }

  return origin;
}

export function getSocketUrl(origin: string): string {
  return `${normalizeApiOrigin(origin)}/chat`;
}

export async function apiRequest<T>({
  origin,
  accessToken,
  path,
  method = 'GET',
  body,
  signal,
  timeoutMs = 45_000,
}: ApiRequestOptions): Promise<T> {
  const timeoutController = signal ? null : new AbortController();
  const timeout = timeoutController
    ? setTimeout(() => timeoutController.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(`${normalizeApiOrigin(origin)}/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(accessToken?.trim()
          ? { Authorization: `Bearer ${accessToken.trim()}` }
          : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? timeoutController?.signal,
    });

    const responseText = await response.text();
    const payload = parseResponseBody(responseText);

    if (!response.ok) {
      throw new ApiRequestError(response.status, payload);
    }

    return payload as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseResponseBody(responseText: string): unknown {
  if (responseText.length === 0) return null;

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return responseText;
  }
}

function readApiErrorMessage(status: number, payload: unknown): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }

  return `Request failed with HTTP ${status}.`;
}
