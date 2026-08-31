import { ApiError } from "./api";

export const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * A 422 carries an engine's own French sentence — a deliberate refusal, not a
 * load failure. The two get different treatments on every screen in this phase:
 * a refusal is CONTENT, in the panel's own voice, and a failure is an
 * `role="alert"`. Phase 2A shipped a refusal dressed as an alert and had to
 * correct it.
 *
 * Returns `null` on anything that is not a refusal, so the caller branches on
 * the null rather than on a status code it would have to know about.
 *
 * `AnalysisPage` and `FeasibilityPage` each grew a private copy of this pair;
 * the three simulators would have been the fourth, fifth and sixth.
 */
export function refusalReason(err: unknown): string | null {
  return err instanceof ApiError && err.status === 422 ? err.detail : null;
}

export function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}
