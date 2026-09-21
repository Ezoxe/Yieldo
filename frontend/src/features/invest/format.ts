import { formatCents } from "../../design/theme";

/**
 * Basis points, and the one place they become French.
 *
 * Every rate on the wire is an integer number of basis points — `347` is
 * 3,47 %. Formatting it in each component would put `/ 100` in a dozen places,
 * which is exactly how a percentage ends up shown a hundred times too large on
 * one screen and not the others.
 */

const NARROW_NBSP = " ";
const NBSP = " ";
const MINUS = "−";

export function formatBps(bps: number, options: { signed?: boolean; decimals?: number } = {}): string {
  const { signed = false, decimals = 2 } = options;
  const value = Math.abs(bps) / 100;
  const body = value
    .toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .replace(/\s/g, NARROW_NBSP);
  const sign = bps < 0 ? MINUS : signed && bps > 0 ? "+" : "";
  return `${sign}${body}${NBSP}%`;
}

/** A probability, read as a whole percentage — 6 500 becomes « 65 % ». */
export function formatProbability(bps: number): string {
  return formatBps(bps, { decimals: 0 });
}

/** Milliseconds, as a reader reads them: « 84 ms », « 1,2 s ». */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}${NBSP}ms`;
  return `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${NBSP}s`;
}

/**
 * A unit count as stored: the backend keeps eighteen decimal places, and a
 * screen showing `0.010000000000000000 BTC` is showing a data structure rather
 * than a quantity. Trailing zeros go; the significant digits stay, all of them.
 */
export function formatQuantity(raw: string | null | undefined): string {
  if (!raw) return "—";
  if (!raw.includes(".")) return raw;
  const trimmed = raw.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

/** A timestamp as a French time of day, for a feed read in one sitting. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * How long is left on an arming, said the way someone watching the clock
 * reads it. Returns null once it has expired — an arming that has run out is
 * not an arming, and « il reste −3 min » would be worse than nothing.
 */
export function remainingMinutes(until: string | null, now: Date = new Date()): number | null {
  if (!until) return null;
  const end = new Date(until);
  if (Number.isNaN(end.getTime())) return null;
  const minutes = Math.floor((end.getTime() - now.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

export { formatCents };
