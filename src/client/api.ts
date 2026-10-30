export interface User {
  avatar?: string | null;
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}
export interface Connection {
  id: string;
  name: string;
  host: string;
  readOnly: boolean;
  createdAt: number;
}
export interface Query {
  mode: 'find' | 'aggregate';
  text: string;
  sort: string;
  limit: number;
  skip: number;
}
export interface SavedQuery {
  id: string;
  name: string;
  database: string;
  collection: string;
  query: Query;
}
export interface QueryResult {
  documents: Record<string, unknown>[];
  hasMore: boolean;
  durationMs: number;
}

let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
    },
    ...(method !== 'GET' ? { body: JSON.stringify(data ?? {}) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me')
      window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, result.error ?? `Falha HTTP ${response.status}.`);
  }
  return result as T;
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : 'Falha inesperada.';
}
export const resourcePath = (connection: string, database: string, collection: string) =>
  `/connections/${connection}/databases/${encodeURIComponent(database)}/collections/${encodeURIComponent(collection)}`;
