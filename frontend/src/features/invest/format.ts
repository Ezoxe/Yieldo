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

/** How many decimals a unit count is shown to. See `formatQuantity`. */
export const QUANTITY_DECIMALS = 8;

/**
 * A unit count, as a person reads one.
 *
 * The backend stores eighteen decimal places, because a token with eighteen of
 * them exists and rounding one away in the ledger would be real money lost.
 * On screen that is a data structure, not a quantity: « 11.207306749155836804 »
 * was really on the positions table, with a decimal POINT in a French
 * interface, and it told a reader nothing that « 11,2073067 » does not.
 *
 * So this shortens for display only — eight decimals, trailing zeros gone,
 * French decimal comma — and the caller puts the stored value on the element's
 * `title` so the exact figure is never actually hidden. That is the same
 * "convert at the display boundary" rule the rest of the app follows for
 * money; nothing here ever feeds back into a computation.
 */
export function formatQuantity(
  raw: string | null | undefined, decimals: number = QUANTITY_DECIMALS,
): string {
  if (!raw) return "—";
  if (!raw.includes(".")) return raw;
  const [whole, fraction = ""] = raw.split(".");
  const kept = fraction.slice(0, decimals).replace(/0+$/, "");
  if (kept === "") return whole === "" || whole === "-" ? "0" : whole;
  return `${whole},${kept}`;
}

/** Whether `formatQuantity` had to drop digits — the caller then shows the
 *  stored value on `title` rather than pretending there were none. */
export function quantityIsShortened(
  raw: string | null | undefined, decimals: number = QUANTITY_DECIMALS,
): boolean {
  if (!raw || !raw.includes(".")) return false;
  const fraction = raw.split(".")[1] ?? "";
  return fraction.slice(decimals).replace(/0+$/, "") !== "";
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
