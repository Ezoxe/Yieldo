import type { PositionValuation, PriceQuote } from "../../lib/types";

/**
 * The three answers a price can be, told apart ONCE.
 *
 * This is the distinction the whole screen exists to make, and the one the
 * plan says this project keeps blurring. They are not three degrees of the
 * same thing — they are three different facts with three different remedies:
 *
 * - **`fresh`** — a real price, fetched inside its TTL. It counts toward every
 *   total and every weight, and nothing needs saying about it.
 * - **`stale`** — ALSO a real price, and it ALSO counts toward every total.
 *   The cache answered past its TTL rather than forcing a call the quota pool
 *   might have refused. It is not a failure and must never be drawn as one;
 *   what it needs is its AGE printed beside it, which is why `fetched_at`
 *   travels with it.
 * - **`missing`** — no price at all. `market_value_cents` is `null`, the
 *   position is **excluded from every total**, and it carries one of
 *   `market/client.py`'s five French causes. That sentence is printed
 *   verbatim: "aucune clé", "clé refusée", "quota épuisé", "service
 *   injoignable" and "symbole inconnu" are five different remedies, and a
 *   screen that blurred two of them would send the reader to fix the wrong
 *   thing.
 *
 * There is a fourth state that is not a price state at all: a position whose
 * lots sum to zero units is valued at a real 0 without any price ever being
 * consulted (`engines/portfolio.py`). It is `not_required` — genuinely valued,
 * with nothing missing — and drawing it as a failure would overstate what this
 * portfolio could not value, which is exactly backwards for a screen whose job
 * is to say what is unknown.
 */
export type PriceState =
  | { kind: "fresh"; price: PriceQuote }
  | { kind: "stale"; price: PriceQuote }
  | { kind: "missing"; reason: string }
  | { kind: "not_required" };

export function priceStateOf(position: PositionValuation): PriceState {
  if (position.price !== null) {
    return position.price.is_stale
      ? { kind: "stale", price: position.price }
      : { kind: "fresh", price: position.price };
  }
  if (position.price_unavailable_reason !== null) {
    return { kind: "missing", reason: position.price_unavailable_reason };
  }
  // No price and no cause: nothing was ever asked for. See the doc above.
  return { kind: "not_required" };
}

/** Whole days between two instants, floored — never rounded up, so a price
 *  fetched this morning reads "aujourd'hui" and not "il y a 1 jour". */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * How old a stale price is, in French — the sentence that makes a stale value
 * honest rather than merely present.
 *
 * `now` is a parameter, never `new Date()` read inside: the same discipline
 * every pure module in this codebase follows, and the only way a test can
 * assert an age without waiting for one.
 *
 * Returns `null` when `fetched_at` cannot be parsed. Never a fallback age —
 * "il y a 0 jour" on an unparseable timestamp would be a measurement nobody
 * made.
 */
export function staleAgeSentence(fetchedAt: string, now: Date): string | null {
  const fetched = new Date(fetchedAt);
  if (Number.isNaN(fetched.getTime())) return null;

  const days = daysBetween(fetched, now);
  if (days < 0) return null; // A price fetched in the future is not an age.
  if (days === 0) {
    const hours = Math.floor((now.getTime() - fetched.getTime()) / 3_600_000);
    if (hours < 1) return "relevé il y a moins d'une heure";
    return `relevé il y a ${hours} ${hours === 1 ? "heure" : "heures"}`;
  }
  if (days === 1) return "relevé hier";
  return `relevé il y a ${days} jours`;
}
