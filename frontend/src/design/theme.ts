export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type DensityPreference = "comfortable" | "compact";

const STORAGE_KEY = "yieldo.theme";
const DENSITY_STORAGE_KEY = "yieldo.density";
const MOTION_DISABLED_STORAGE_KEY = "yieldo.motion-disabled";
const NARROW_NBSP = " "; // French thousands separator, non-breaking
const NBSP = " ";
const MINUS = "−"; // typographic minus, aligns with digit width

export function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private browsing can deny localStorage entirely — fall through to the default.
  }
  return "system";
}

export function storeTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Persisting a preference is a convenience, not a requirement.
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function readStoredDensity(): DensityPreference {
  try {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (stored === "comfortable" || stored === "compact") return stored;
  } catch {
    // Private browsing can deny localStorage entirely.
  }
  return "comfortable";
}

export function storeDensity(density: DensityPreference): void {
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Persisting a preference is a convenience, not a requirement.
  }
}

// The Reglages "Animations" switch: an explicit user override that disables
// motion regardless of what the OS-level prefers-reduced-motion reports.
export function readStoredMotionDisabled(): boolean {
  try {
    return localStorage.getItem(MOTION_DISABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function storeMotionDisabled(disabled: boolean): void {
  try {
    localStorage.setItem(MOTION_DISABLED_STORAGE_KEY, disabled ? "true" : "false");
  } catch {
    // Persisting a preference is a convenience, not a requirement.
  }
}

interface FormatOptions {
  signed?: boolean;
  decimals?: 0 | 2;
  currency?: string;
}

export function formatCents(cents: number, options: FormatOptions = {}): string {
  const { signed = false, decimals = 2, currency = "€" } = options;
  const absolute = Math.abs(cents) / 100;
  const body = absolute
    .toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    .replace(/\s/g, NARROW_NBSP);

  const sign = cents < 0 ? MINUS : signed && cents > 0 ? "+" : "";
  return `${sign}${body}${NBSP}${currency}`;
}

/**
 * The inverse of {@link formatCents}: a typed or pasted euro amount, back to an
 * integer number of cents.
 *
 * String arithmetic throughout, never `parseFloat(x) * 100` -- 8.70 through a
 * float is 869.9999999999999, and `Math.round` hiding that is exactly the kind
 * of silent conversion the integer-cents rule exists to prevent.
 *
 * Accepts what a French user actually types or pastes: a comma or a dot, the
 * narrow no-break spaces and the "€" that `formatCents` itself emits, and the
 * typographic minus it uses for negatives. Returns `null` -- never 0 -- for
 * anything it cannot read exactly, including more than two decimals: rounding
 * a third digit away would change the number the user typed without saying so.
 */
export function parseCents(text: string): number | null {
  // \s already covers U+00A0 and U+202F, the two spaces formatCents emits; both
  // are spelt out as escapes so the source carries no invisible characters.
  const cleaned = text
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/€/g, "")
    .replace(MINUS, "-")
    .replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/**
 * Basis points as a French percentage: 490 is "4,90 %".
 *
 * Integer arithmetic, like every amount here — not because a rate is money (it
 * is not) but because the two digits after the comma ARE the basis points, and
 * dividing by 100 to format them would be a float doing nothing a modulo cannot.
 *
 * Never clamped. The operator's own debt ratio is 19 610 bps — "196,10 %" — and
 * a helper that capped it at the HCSF threshold would hide the whole answer.
 *
 * Lived in `features/debts/DebtsPage.tsx` until `/faisabilite` became its second
 * caller.
 */
export function formatRateBps(bps: number): string {
  const sign = bps < 0 ? MINUS : "";
  const absolute = Math.abs(bps);
  return `${sign}${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}${NBSP}%`;
}

/**
 * The inverse of {@link formatRateBps}: a typed percentage into integer basis
 * points. `null` — never 0 — for anything it cannot read exactly.
 *
 * `Number(text) * 100` is acceptable **here and only here**, because a rate is
 * not money: it is a ratio the engine converts to a `Decimal` before it ever
 * multiplies a cents value, so no float reaches an amount. **Do not copy this
 * onto a euro field** — that is what {@link parseCents} exists for, and
 * `parseFloat("8.70") * 100` is 869.9999999999999.
 *
 * Lived in `features/debts/DebtForm.tsx` until `/patrimoine`'s allocation
 * targets became its second caller, which is when it moved here beside its own
 * inverse rather than being imported across features.
 */
export function parseRateBps(text: string): number | null {
  const cleaned = text.replace(/[\s  %]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/**
 * The inverse of {@link parseCents} for a form field's initial value: integer
 * cents back into what the field shows, by integer arithmetic — 150 000 is
 * "1500,00". Never `cents / 100` formatted as a float.
 *
 * No thousands separator and no "€": this is what goes INTO an `<input>`, and
 * `parseCents` must be able to read it back unchanged. `formatCents` is for
 * display.
 *
 * `DebtForm` and `GoalForm` each carried a private copy, the second of which
 * documented that a third caller was the moment it moved here. `PurchaseForm`
 * is that third caller.
 */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

/**
 * A `engines.quantity.Quantity`, as text, made readable.
 *
 * **A quantity is NOT money, and this is not `formatCents`.** It sits here, on
 * purpose, immediately beside the money formatters: the mistake this function
 * exists to prevent is a developer reaching for `formatCents` on a holding's
 * unit count, which would read "12.000000000000000000" as an integer number of
 * cents and print a hundred million billion euros. There is no `cents`
 * parameter here and no currency anywhere in the output.
 *
 * The wire form is the canonical 18-decimal scale the backend stores and
 * returns ("12.000000000000000000", "0.250000000000000000"). Trailing zeros in
 * the fraction are meaningless precision, so they are trimmed — 12 shares read
 * as "12" and a quarter of a bitcoin as "0,25" — while a genuinely small
 * holding keeps every digit it was given (0,000000015 BTC stays exact).
 *
 * **String arithmetic throughout, never `Number(text)`.** A float cannot hold
 * eighteen decimal places, and rounding one away here would silently change a
 * crypto holding the whole `Quantity` type exists to keep exact.
 */
export function formatQuantity(text: string): string {
  const negative = text.startsWith("-") || text.startsWith(MINUS);
  const body = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = body.split(".");

  // Grouped by threes from the right, the way `toLocaleString` would — but on
  // the STRING, so a 40-digit integer part survives intact.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  const trimmed = fraction.replace(/0+$/, "");

  const sign = negative ? MINUS : "";
  return trimmed.length === 0 ? `${sign}${grouped}` : `${sign}${grouped},${trimmed}`;
}

export function formatCompactCents(cents: number, currency = "€"): string {
  const units = Math.abs(cents) / 100;
  const sign = cents < 0 ? MINUS : "";

  const scale = (value: number, suffix: string) =>
    `${sign}${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${NBSP}${suffix}${currency}`;

  if (units >= 1_000_000) return scale(units / 1_000_000, "M");
  if (units >= 1_000) return scale(units / 1_000, "k");
  return `${sign}${Math.round(units).toLocaleString("fr-FR")}${NBSP}${currency}`;
}
