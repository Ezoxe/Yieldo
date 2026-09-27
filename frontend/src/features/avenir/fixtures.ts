import type { Outlook, OutlookDay, OutlookReliability } from "../../lib/types";

/**
 * The demo household's current account on 22 September 2026 (see
 * `e2e/seed_demo_household.py`): overdrawn by a few euros before the salary of
 * the 28th, lowest the day before it. Shared by the tests and the `?apercu=1`
 * stub, typed against the wire so the next drift is a compile error.
 */
function days(): OutlookDay[] {
  const result: OutlookDay[] = [];
  const start = Date.UTC(2026, 8, 23);
  for (let offset = 0; offset < 90; offset += 1) {
    const on = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
    const salaryPassed = on >= "2026-09-28";
    const p50 = salaryPassed ? 262_000 - offset * 300 : -1_956 - offset * 3_300;
    const half = 4_000 + offset * 350;
    result.push({ on, p10_cents: p50 - half, p50_cents: p50, p90_cents: p50 + half });
  }
  return result;
}

export const OUTLOOK = {
  scope: "checking",
  as_of: "2026-09-22",
  today: "2026-09-27",
  stale_days: 5,
  horizon_end: "2026-12-21",
  opening_balance_cents: -1_956,
  threshold_cents: 0,
  threshold_source: "zero",
  days: days(),
  events: [
    { on: "2026-09-28", amount_cents: 281_000, label: "VIR SEPA ACME SAS SALAIRE",
      source: "detected", series: "detected:vir sepa acme sas salaire", category_id: null,
      balance_after_cents: 262_000 },
    { on: "2026-09-30", amount_cents: -30_000, label: "VIR PERMANENT VERS LIVRET A",
      source: "detected", series: "detected:vir permanent vers livret a", category_id: null,
      balance_after_cents: 225_000 },
    { on: "2026-10-05", amount_cents: -92_000, label: "PRLV SEPA FONCIA LOYER",
      source: "detected", series: "detected:prlv sepa foncia loyer", category_id: null,
      balance_after_cents: 120_000 },
    { on: "2026-10-15", amount_cents: -31_000, label: "Solde d'impôt", source: "planned",
      series: "planned:1", category_id: null, balance_after_cents: 60_000 },
  ],
  months: [
    { key: "2026-09", p10_cents: 210_000, p50_cents: 224_102, p90_cents: 238_000,
      low_on: "2026-09-27", low_p50_cents: -18_457 },
    { key: "2026-10", p10_cents: 190_000, p50_cents: 227_456, p90_cents: 265_000,
      low_on: "2026-10-27", low_p50_cents: 8_000 },
    { key: "2026-11", p10_cents: 180_000, p50_cents: 240_726, p90_cents: 300_000,
      low_on: "2026-11-27", low_p50_cents: 12_000 },
  ],
  low_point: { on: "2026-09-27", p50_cents: -18_457, p10_cents: -32_927 },
  risk: "probable",
  first_breach_on: "2026-09-23",
  variable_daily_cents: -3_399,
  band: true,
  band_unavailable_reason: null,
  residual_months: 18,
  profile_measured: true,
  warnings: [],
  series: [
    { id: "detected:vir sepa acme sas salaire", label: "VIR SEPA ACME SAS SALAIRE",
      source: "detected", amount_cents: 281_000, periodicity: "monthly" },
    { id: "detected:prlv sepa foncia loyer", label: "PRLV SEPA FONCIA LOYER",
      source: "detected", amount_cents: -92_000, periodicity: "monthly" },
  ],
  counts: { detected: 11, declared: 0, planned: 1, reconciled: 0 },
  empty_reason: null,
} satisfies Outlook;

export const RELIABILITY = {
  scope: "checking",
  refusal: null,
  horizons: [
    { horizon_months: 1, replays: 12, mean_abs_error_cents: 33_016,
      median_abs_error_cents: 28_981, bias_cents: 5_688, inside_band: 9 },
    { horizon_months: 3, replays: 10, mean_abs_error_cents: 75_135,
      median_abs_error_cents: 75_753, bias_cents: 40_539, inside_band: 6 },
  ],
} satisfies OutlookReliability;
