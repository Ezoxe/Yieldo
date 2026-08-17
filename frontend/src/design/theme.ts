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

export function formatCompactCents(cents: number, currency = "€"): string {
  const units = Math.abs(cents) / 100;
  const sign = cents < 0 ? MINUS : "";

  const scale = (value: number, suffix: string) =>
    `${sign}${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${NBSP}${suffix}${currency}`;

  if (units >= 1_000_000) return scale(units / 1_000_000, "M");
  if (units >= 1_000) return scale(units / 1_000, "k");
  return `${sign}${Math.round(units).toLocaleString("fr-FR")}${NBSP}${currency}`;
}
