import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useLedgerMode } from "../features/plan/useLedgerMode";
import { api, type ApiError } from "./api";

type QueryValue = string | number | boolean | undefined | null;

/**
 * How long a screen's answer is trusted before it is asked again. Thirty
 * seconds: long enough that going Vue d'ensemble → Transactions → Vue
 * d'ensemble paints the second visit from cache instead of a skeleton, short
 * enough that a statement imported a minute ago is on screen the next time
 * the reader looks. A mutation on a screen still invalidates its own key —
 * see `useInvalidate` — so the window only ever covers reads nobody changed.
 */
export const API_QUERY_STALE_MS = 30_000;

/**
 * One GET, cached under its path, its parameters and the ledger mode.
 *
 * The mode is part of the key on purpose: every analytics route answers
 * differently in « Réel », « Estimé » and « Réel complété », and `AppShell`
 * already re-keys its `Outlet` on the mode so a change refetches every
 * screen. A cache that ignored the mode would hand the « Réel » figure back
 * under the « Estimé » label — a lie told from memory.
 *
 * Thin by design: the wrapper owns the key shape and the stale window and
 * nothing else, so a screen reads `data`, `isPending` and `error.detail` the
 * way it read its own `useState` triplet before.
 */
export function useApiQuery<T>(
  path: string,
  params?: Record<string, QueryValue>,
  options: { enabled?: boolean } = {},
): UseQueryResult<T, ApiError> {
  const mode = useLedgerMode((state) => state.mode);
  return useQuery<T, ApiError>({
    queryKey: apiQueryKey(path, params, mode),
    queryFn: () => api.get<T>(path, params),
    staleTime: API_QUERY_STALE_MS,
    retry: false,
    enabled: options.enabled ?? true,
  });
}

/** The key `useApiQuery` files a request under; exported so a mutation can invalidate it. */
export function apiQueryKey(
  path: string,
  params: Record<string, QueryValue> | undefined,
  mode: string,
): readonly unknown[] {
  return ["api", mode, path, params ?? {}];
}

/**
 * Drops every cached answer for `path` (all parameters, all modes), so the
 * next render asks again. Called after a mutation on the screen that owns the
 * path — a saved budget re-asks for the month on screen without a skeleton,
 * because the previous answer stays painted until the new one lands.
 */
export function useInvalidate(): (path: string) => Promise<void> {
  const client = useQueryClient();
  return (path: string) =>
    client.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "api" && query.queryKey[2] === path,
    });
}
