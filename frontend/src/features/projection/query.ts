/**
 * The `/projection` run, as it travels in the URL.
 *
 * **The seed lives in the address bar on purpose.** `/api/projection` requires
 * one and refuses to generate one, because a Monte Carlo run nobody can
 * reproduce is not a measurement. Putting the whole run in `?graine=…` makes
 * it bookmarkable and quotable: the same link redraws the same band, which is
 * what "reproducible" has to mean for a household, not only for a test suite.
 *
 * The parameter names are French, like every other query string this app owns
 * (`?onglet=`, `?periode=`): a URL is user-facing text.
 */
import type { ProjectionAssumptions } from "../../lib/types";

/** `engines/savings.py`'s MAX_PROJECTION_MONTHS, and `engines/montecarlo.py`'s
 *  MAX_TRIALS. Mirrored so the form can refuse in French before the round trip;
 *  `ProjectionPage.test.tsx` pins them against the API's own 422 wording. */
export const MAX_MONTHS = 600;
export const MAX_TRIALS = 5_000;

/** `api/projection.py`'s own defaults, so a first load with an empty URL asks
 *  for exactly what the API would have applied anyway. */
export const DEFAULT_MONTHS = 240;
export const DEFAULT_ANNUAL_RETURN_BPS = 300;
export const DEFAULT_ANNUAL_VOLATILITY_BPS = 1_500;
export const DEFAULT_TRIALS = 1_000;
export const DEFAULT_WITHDRAWAL_RATE_BPS = 400;

export interface ProjectionQuery {
  seed: number;
  months: number;
  annual_return_bps: number;
  annual_volatility_bps: number;
  trials: number;
  withdrawal_rate_bps: number;
  /** `null` means the barème option is not priced. Never 0, which is a real
   *  (very low) income-tax bracket. */
  marginal_rate_bps: number | null;
  joint_taxation: boolean;
}

/**
 * A seed for a run the URL does not carry one for.
 *
 * `Math.random` is fine HERE and only here: this picks which reproducible run
 * to show first, and the number it picks is immediately written into the URL
 * and printed on screen. Nothing about the projection itself is random from
 * the reader's point of view — the randomness is chosen once, visibly, and
 * then fixed. The API never does this, which is the point.
 */
export function freshSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function readInt(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? value : fallback;
}

/** The URL's own run, filled in with the API's defaults for anything absent.
 *  A malformed value falls back to the default rather than throwing: a pasted
 *  link with one bad parameter should still draw a projection, and the
 *  assumptions panel prints what actually ran either way. */
export function queryFromParams(params: URLSearchParams, seed: number): ProjectionQuery {
  const marginalRaw = params.get("tmi");
  const marginal = marginalRaw === null ? null : Number(marginalRaw);
  return {
    seed,
    months: readInt(params, "horizon", DEFAULT_MONTHS),
    annual_return_bps: readInt(params, "rendement", DEFAULT_ANNUAL_RETURN_BPS),
    annual_volatility_bps: readInt(params, "volatilite", DEFAULT_ANNUAL_VOLATILITY_BPS),
    trials: readInt(params, "trajectoires", DEFAULT_TRIALS),
    withdrawal_rate_bps: readInt(params, "retrait", DEFAULT_WITHDRAWAL_RATE_BPS),
    marginal_rate_bps: marginal === null || !Number.isInteger(marginal) ? null : marginal,
    joint_taxation: params.get("commune") === "1",
  };
}

/** The run, back into search parameters. `tmi` is omitted entirely when no
 *  marginal rate is set — writing `tmi=` would be indistinguishable from
 *  `tmi=0` on the way back in, and those are two different answers. */
export function paramsFromQuery(query: ProjectionQuery): URLSearchParams {
  const params = new URLSearchParams({
    graine: String(query.seed),
    horizon: String(query.months),
    rendement: String(query.annual_return_bps),
    volatilite: String(query.annual_volatility_bps),
    trajectoires: String(query.trials),
    retrait: String(query.withdrawal_rate_bps),
  });
  if (query.marginal_rate_bps !== null) params.set("tmi", String(query.marginal_rate_bps));
  if (query.joint_taxation) params.set("commune", "1");
  return params;
}

/** What `api.get` sends. `joint_taxation` always travels, because `false` is a
 *  real answer the tax computation needs; `marginal_rate_bps` travels only when
 *  set, since `buildUrl` drops nulls and that is exactly right here. */
export function requestParams(query: ProjectionQuery): Record<string, string | number | boolean | null> {
  return {
    seed: query.seed,
    months: query.months,
    annual_return_bps: query.annual_return_bps,
    annual_volatility_bps: query.annual_volatility_bps,
    trials: query.trials,
    withdrawal_rate_bps: query.withdrawal_rate_bps,
    marginal_rate_bps: query.marginal_rate_bps,
    joint_taxation: query.joint_taxation,
  };
}

/** The assumptions the API echoed back, as a query — so the form always edits
 *  what actually ran rather than what was typed. */
export function queryFromAssumptions(assumptions: ProjectionAssumptions): ProjectionQuery {
  return {
    seed: assumptions.seed,
    months: assumptions.months,
    annual_return_bps: assumptions.annual_return_bps,
    annual_volatility_bps: assumptions.annual_volatility_bps,
    trials: assumptions.trials,
    withdrawal_rate_bps: assumptions.withdrawal_rate_bps,
    marginal_rate_bps: assumptions.marginal_rate_bps,
    joint_taxation: assumptions.joint_taxation,
  };
}
