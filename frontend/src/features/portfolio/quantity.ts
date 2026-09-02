/**
 * A holding's unit count, at the wire boundary — the browser-side counterpart
 * of `backend/app/engines/quantity.py`.
 *
 * **A quantity is not money, and none of this is `parseCents`.** The two look
 * alike and behave differently on purpose: money is an integer number of cents
 * and stops at two decimals, while a quantity is a `Decimal` at a fixed scale
 * of eighteen places carried as a STRING — deep enough for an 18-decimal token,
 * far deeper than a share count. `formatCents` on one of these prints a hundred
 * million billion euros; `Number()` on one of them rounds a crypto holding away.
 *
 * **String arithmetic throughout, never a `float`.** Parsing pads the fraction
 * to the canonical scale by string manipulation, and {@link sumQuantities} adds
 * through `BigInt` over the scaled integers — 0,1 + 0,2 is exactly 0,3 here,
 * which it is not through a JavaScript number.
 *
 * **More than eighteen decimals is refused, never truncated.** That is the one
 * rule `engines/quantity.py` states outright ("plus de 18 décimales ne sont pas
 * prises en charge"), for the reason CLAUDE.md forbids fallbacks: silently
 * discarding real precision is a value nobody typed.
 */

/** `engines.quantity.SCALE`. The two must agree, or a value this module calls
 *  valid is one the backend refuses. */
export const QUANTITY_SCALE = 18;

export type QuantityResult = { quantity: string } | { error: string };

const MISSING =
  "Quantité manquante : indiquez le nombre d'unités acquises, par exemple 12 ou 0,25.";

/** `schemas.portfolio._quantity_field_validator`'s own sentence, word for word:
 *  the field and the backend must refuse the same input for the same stated
 *  reason, or the screen teaches a rule the API does not apply. */
const NOT_POSITIVE =
  "La quantité d'un lot doit être strictement positive : un lot est une acquisition, jamais une cession.";

function unreadable(raw: string): string {
  return `Quantité illisible : « ${raw} » n'est pas un nombre. Saisissez un nombre d'unités, par exemple 12 ou 0,25.`;
}

/**
 * A typed unit count, into the canonical 18-decimal string the API stores.
 *
 * Accepts what a French user actually types: a comma or a dot, and the spaces
 * a pasted figure carries (U+00A0 and U+202F included, the two `formatQuantity`
 * itself emits when it groups thousands). Everything else is refused with the
 * cause that is true of THIS input — an empty field is missing, not unreadable;
 * a nineteenth decimal is too precise, not unreadable; and zero is neither.
 */
export function parseQuantity(text: string): QuantityResult {
  const raw = text.trim();
  if (raw.length === 0) return { error: MISSING };

  const cleaned = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) return { error: unreadable(raw) };

  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/^[+-]/, "");
  const [wholeRaw = "", fraction = ""] = unsigned.split(".");

  if (fraction.length > QUANTITY_SCALE) {
    const excess = fraction.length - QUANTITY_SCALE;
    return {
      error:
        `Quantité trop précise : ${fraction.length} décimales ont été saisies et Yieldo ` +
        `n'en conserve que ${QUANTITY_SCALE}. Aucune décimale n'est arrondie en silence : ` +
        `retirez-en ${excess}.`,
    };
  }

  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  // Zero is zero however it is spelled — "0", "0,000" and "-0" are all a lot
  // that acquired nothing, which is the same refusal a negative gets.
  const isZero = /^0*$/.test(whole) && /^0*$/.test(fraction);
  if (isZero || negative) return { error: NOT_POSITIVE };

  return { quantity: `${whole}.${fraction.padEnd(QUANTITY_SCALE, "0")}` };
}

/**
 * The inverse, for a field's initial value: the canonical wire form back into
 * what the input shows, with the comma a French keyboard types.
 *
 * The padding zeros carry no information and would make "12" read as
 * "12,000000000000000000" in an editable field, so they go — while a genuinely
 * small holding keeps every digit it was given. `parseQuantity` reads back
 * exactly what this produces.
 */
export function quantityToInput(canonical: string): string {
  const [whole = "0", fraction = ""] = canonical.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length === 0 ? whole : `${whole},${trimmed}`;
}

/**
 * The total a position actually holds: the sum of its lots.
 *
 * **A position never stores a total** (`models/position.py`), so this is the
 * only place one exists — computed, on the canonical scale, through `BigInt`
 * over the scaled integers rather than through addition on numbers. It is what
 * lets the lot form say what the position will hold before the lot is saved.
 */
export function sumQuantities(values: string[]): string {
  let total = 0n;
  for (const value of values) {
    const [whole = "0", fraction = ""] = value.split(".");
    total += BigInt(`${whole}${fraction.padEnd(QUANTITY_SCALE, "0").slice(0, QUANTITY_SCALE)}`);
  }
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(QUANTITY_SCALE + 1, "0");
  const whole = digits.slice(0, digits.length - QUANTITY_SCALE);
  const fraction = digits.slice(digits.length - QUANTITY_SCALE);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
