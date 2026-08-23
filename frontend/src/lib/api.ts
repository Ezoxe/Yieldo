import type { User } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

type QueryValue = string | number | boolean | undefined | null;

// The shape POST /api/auth/refresh resolves to — same fields as login/register,
// so whoever consumes onTokenRefreshed can apply it through the exact same
// code path those two use.
export interface RefreshedSession {
  access_token: string;
  user: User;
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let onSessionRefreshed: ((session: RefreshedSession) => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function onUnauthorized(handler: () => void): void {
  onSessionLost = handler;
}

// Registered by the session store so a *silent* refresh (triggered internally
// below, on a 401 from some unrelated request) updates useSession() the same
// way login/register/hydrate do. Without this, the module-scope accessToken
// here and useSession.getState().accessToken can disagree after a refresh —
// the store never hears about it.
export function onTokenRefreshed(handler: (session: RefreshedSession) => void): void {
  onSessionRefreshed = handler;
}

function buildUrl(path: string, params?: Record<string, QueryValue>): string {
  const url = `/api${path}`;
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.clone().json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return body.detail[0].msg;
  } catch {
    // Not JSON — fall through to the generic message below.
  }
  return "Une erreur inattendue est survenue.";
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function refreshSession(): Promise<boolean> {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) return false;
  const body = (await response.json()) as RefreshedSession;
  setAccessToken(body.access_token);
  onSessionRefreshed?.(body);
  return true;
}

async function request<T>(
  method: string,
  path: string,
  options: { params?: Record<string, QueryValue>; body?: unknown; form?: FormData } = {},
  isRetry = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(buildUrl(path, options.params), {
    method,
    headers,
    credentials: "include",
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  if (response.status === 401 && !isRetry && !path.startsWith("/auth/")) {
    // One refresh attempt, then give up: retrying a failed refresh would loop.
    if (await refreshSession()) return request<T>(method, path, options, true);
    onSessionLost?.();
  }

  if (!response.ok) throw new ApiError(response.status, await readError(response));
  return parse<T>(response);
}

export const api = {
  get: <T>(path: string, params?: Record<string, QueryValue>) =>
    request<T>("GET", path, { params }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  // PUT and PATCH are both here because the backend genuinely uses both, and
  // they are not interchangeable: PUT /analysis/price-index REPLACES the whole
  // stored series (posting it twice is idempotent, and an empty list clears
  // it), while PATCH amends the fields it is given.
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
};
