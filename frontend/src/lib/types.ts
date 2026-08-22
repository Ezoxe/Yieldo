// Mirror types for the backend's Pydantic schemas (see backend/app/schemas/*.py).
// Field names reproduce the JSON exactly, `amount_cents` included — no implicit
// conversion happens on the way in; only `formatCents` converts for display.

export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface Account {
  id: number;
  name: string;
  kind: string;
  currency: string;
  opening_balance_cents: number;
  opened_on: string | null;
  include_in_net_worth: boolean;
  archived: boolean;
}

export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  kind: string;
  color: string;
  icon: string;
  monthly_budget_cents: number | null;
  is_essential: boolean;
}

export interface Transaction {
  id: number;
  account_id: number;
  date: string;
  value_date: string | null;
  amount_cents: number;
  label_raw: string;
  label_clean: string;
  category_id: number | null;
  category_source: string;
  is_transfer: boolean;
  is_recurring: boolean;
  notes: string | null;
  tags: string[];
}

// The span of the user's whole ledger, whatever period is being asked about.
// `null` on the wire means they have no transactions at all — which is what
// tells an empty screen apart from a screen pointed at an empty window.
export interface History {
  date_from: string;
  date_to: string;
  transaction_count: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
  // How many transactions the date range holds with every other filter
  // dropped: `total === 0` alone cannot say whether the period is empty or a
  // filter is hiding what is in it.
  period_total: number;
  history: History | null;
}

// PATCH /api/transactions/{id}'s response: the updated transaction plus what the
// backend did as a side effect of a category change -- a rule learned from the
// correction (if any) and how many other rows it silently backfilled.
export interface TransactionPatchResult extends Transaction {
  learned_rule_id: number | null;
  backfilled: number;
}

export const COLUMN_ROLES = [
  "date",
  "value_date",
  "amount",
  "debit",
  "credit",
  "label",
  "category",
  "account",
  "currency",
  "balance",
  "notes",
  "reference",
  "ignore",
] as const;

export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const ROLE_LABELS: Record<ColumnRole, string> = {
  date: "Date",
  value_date: "Date de valeur",
  amount: "Montant",
  debit: "Débit",
  credit: "Crédit",
  label: "Libellé",
  category: "Catégorie",
  account: "Compte",
  currency: "Devise",
  balance: "Solde",
  notes: "Notes",
  reference: "Référence",
  ignore: "Ignorer",
};

export interface CsvDialect {
  encoding: string;
  delimiter: string;
  decimal_separator: string;
  date_format: string;
  header_row: number;
  preamble_rows: number;
  quotechar: string;
  sample_headers: string[];
}

export interface PreviewRow {
  row_number: number;
  date: string | null;
  amount_cents: number | null;
  label_raw: string;
  category_id: number | null;
  category_name: string | null;
  category_source: string;
  is_duplicate: boolean;
  error: string | null;
}

export interface ImportSummary {
  total: number;
  importable: number;
  duplicates: number;
  failed: number;
  date_from: string | null;
  date_to: string | null;
  inflow_cents: number;
  outflow_cents: number;
  mapping_errors: string[];
}

export interface ImportPreview {
  upload_token: string;
  original_filename: string;
  dialect: CsvDialect;
  headers: string[];
  sample_rows: string[][];
  suggested_mapping: Record<string, string>;
  rows: PreviewRow[];
  summary: ImportSummary;
}

export interface ImportBatch {
  id: number;
  account_id: number;
  filename: string;
  rows_total: number;
  rows_imported: number;
  rows_duplicate: number;
  rows_failed: number;
  created_at: string;
}

export interface ColumnProfile {
  id: number;
  name: string;
  dialect: Record<string, unknown>;
  mapping: Record<string, string>;
  created_at: string;
}

export type Granularity = "day" | "week" | "month" | "quarter" | "year";

export interface SeriesBucket {
  key: string;
  start: string;
  end: string;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
  count: number;
}

export interface CategoryBreakdown {
  category_id: number | null;
  name: string;
  color: string;
  total_cents: number;
  count: number;
  share: number;
}

export interface PeriodTotals {
  date_from: string;
  date_to: string;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
  transaction_count: number;
  // A savings rate without income is undefined, not zero — null when inflow is 0.
  savings_rate: number | null;
}

export interface Comparison {
  delta_cents: number;
  delta_ratio: number | null;
}

export interface Summary extends PeriodTotals {
  // Both null when the caller stated no start date: the range then begins at
  // the user's first transaction, so no period precedes it and there is
  // nothing to compare against. Undefined, not zero.
  previous: PeriodTotals | null;
  comparison: Comparison | null;
  history: History | null;
}

export interface CalendarPoint {
  date: string;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
  count: number;
}

// A closed set, not `string`: the backend types this field as the budget
// engine's own BudgetStatus literal, so the OpenAPI schema advertises exactly
// these three values and a fourth would be a backend change, not a surprise.
export type BudgetStatus = "ok" | "at_risk" | "over";

export interface BudgetLine {
  category_id: number;
  name: string;
  color: string;
  is_essential: boolean;
  /** A ceiling, positive. */
  budget_cents: number;
  /** An outflow, negative — take the magnitude for display. */
  spent_cents: number;
  /** Positive while under the ceiling, negative once past it. */
  remaining_cents: number;
  consumed_ratio: number;
  /** null when a projection would be dishonest — never a zero standing in. */
  projected_cents: number | null;
  status: BudgetStatus;
}

export interface UnbudgetedCategory {
  category_id: number;
  name: string;
  color: string;
  spent_cents: number;
}

export interface BudgetReport {
  month: string;
  month_start: string;
  month_end: string;
  days_elapsed: number;
  days_in_month: number;
  is_current_month: boolean;
  lines: BudgetLine[];
  unbudgeted: UnbudgetedCategory[];
  total_budget_cents: number;
  total_spent_cents: number;
  history: History | null;
}

// Recurrences — mirrors backend/app/schemas/recurrences.py. Closed sets rather
// than `string`, because the backend types them off the engine's own Literals.
export type Periodicity = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
export type RecurrenceStatus = "active" | "missing" | "ended";
export type RecurrenceConfidence = "probable" | "confirmed";

export interface PriceChange {
  previous_cents: number;
  current_cents: number;
  changed_on: string;
  /** Signed ratio, not money: 0.185 renders as "+18,5 %". */
  ratio: number;
}

export interface Recurrence {
  label: string;
  label_key: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  periodicity: Periodicity;
  occurrences: number;
  first_on: string;
  last_on: string;
  median_interval_days: number;
  /** The level billed now, signed. After a rise this is the new price. */
  amount_cents: number;
  /**
   * MAD of the amounts at the current level. The only defence against a
   * clockwork non-subscription: `normalize_label` strips card suffixes, so
   * every withdrawal collapses into one weekly-looking group of wildly
   * varying amounts. A screen that hides this presents it as a subscription.
   */
  amount_spread_cents: number;
  /**
   * The current level times its occurrences per year, signed. Published
   * whether or not it may be used — see `annualisable`, which is the gate.
   */
  annual_cents: number;
  /** How much of the calendar the analysed run covers, in days. */
  observed_span_days: number;
  /**
   * Whether `annual_cents` may be read as a yearly cost at all. False below
   * the engine's quarter-year floor: the row is still detected and listed,
   * but its `annual_cents` must never be displayed as a yearly figure and it
   * takes no part in any total. Recurrences arrive sorted on the *un-gated*
   * `annual_cents`, so the largest figure in the payload is routinely one
   * this flag excludes.
   */
  annualisable: boolean;
  expected_next_on: string;
  status: RecurrenceStatus;
  confidence: RecurrenceConfidence;
  price_change: PriceChange | null;
}

export interface RecurrenceReport {
  recurrences: Recurrence[];
  /** Live, annualisable expense recurrences only. Signed (negative). */
  annual_subscription_cents: number;
  monthly_subscription_cents: number;
  analysed_groups: number;
  rejected_thin: number;
  rejected_irregular: number;
  /**
   * French, non-null whenever nothing was detected *or* nothing cleared the
   * annualisation bar. Print it — a zero total with no reason reads as "your
   * subscriptions cost nothing", which is a different claim.
   */
  notice: string | null;
  missing_count: number;
  price_change_count: number;
  /**
   * The last date in the user's whole ledger — and the `today` the backend
   * hands the engine. A recurrence that stops here has run out of imported
   * statements, not necessarily been cancelled, and every stale status on
   * screen has to be phrased against this date. Null on an empty ledger.
   */
  ledger_last_on: string | null;
}

// Cash-flow forecast and runway — mirrors backend/app/schemas/cashflow.py.
// Both engines are measured, never asserted: a forecast month carries a band
// (P10/P50/P90), never a single line, and a runway scenario carries its own
// measured rate rather than a bare number.

export interface ForecastMonth {
  key: string;
  start: string;
  end: string;
  /** Recurring flows due this month, signed. */
  recurring_cents: number;
  /** Everything else, signed. */
  residual_cents: number;
  net_p50_cents: number;
  balance_p10_cents: number;
  balance_p50_cents: number;
  balance_p90_cents: number;
  below_threshold: boolean;
  /** True when this month's estimate came from observations of this same
   *  calendar month rather than from the pooled median. */
  seasonal: boolean;
}

export interface Forecast {
  months: ForecastMonth[];
  /** Months carrying residual (non-recurring) activity — what the band was
   *  actually measured over. */
  months_observed: number;
  /** Complete months the ledger itself covers, independent of whether any of
   *  them carried residual activity. Not the same number as `months_observed`
   *  — a month whose whole activity was recurring carries no residual and is
   *  absent from it. */
  ledger_months_observed: number;
  seasonality_used: boolean;
  /** How many recurrences were actually projected forward — not how many
   *  were detected. An ended or too-young recurrence is deliberately absent
   *  from the chart. */
  recurrences_projected: number;
  threshold_cents: number;
  first_breach_key: string | null;
  opening_balance_cents: number;
  /** French, non-null exactly when `months` is empty. Print it. */
  insufficient_reason: string | null;
  /** The date this projection actually starts counting from — the ledger's
   *  own last transaction date, not necessarily today's real calendar date.
   *  Read this field rather than assume "today" means the real date. */
  projected_from: string;
  /** The ledger's own last transaction date, or null on an empty ledger. */
  ledger_last_on: string | null;
  /** The two scales the band is built from, published so a screen can
   *  explain the band without re-measuring it.
   *  0 on a refusal (`months` empty); read `insufficient_reason` first,
   *  never this field on its own in that case. */
  pooled_scale_cents: number;
  /**
   * Null for two different reasons, and neither is a refusal: no calendar
   * month reached the seasonality sample floor, so nothing was there to
   * measure; or the eligible months were measured and came out cent-exact,
   * so the measurement carries no information. Either way every projected
   * month falls back to the pooled centre and scale, and the projection
   * runs normally — see `app/engines/forecast.py`'s `seasonal_scale_cents`
   * comment. Never a reason on its own to treat the forecast as unavailable.
   */
  seasonal_scale_cents: number | null;
}

/** Mirrors `MeasuredRateOut`: a rate measured from history, with its
 *  variability. `low_cents` / `high_cents` are the P10 / P90 equivalents —
 *  a rate quoted without them invites the reader to treat a median as a
 *  certainty. */
export interface MeasuredRate {
  /** How many months THIS rate was measured over — not the same as
   *  `Runway.months_observed`, which is `normal`'s own sample size.
   *  `essentials` is measured over its own, self-selected set of months
   *  (only those carrying essential-tagged spending), which can be
   *  narrower. */
  months: number;
  median_cents: number;
  spread_cents: number;
  low_cents: number;
  high_cents: number;
}

export interface RunwayScenario {
  name: "normal" | "essentials";
  monthly_burn_cents: number;
  /** The full measured rate this scenario's burn was derived from. */
  rate: MeasuredRate;
  /** A duration in months, not money. Fractional on purpose: a runway of
   *  0,4 mois is a real and important answer. */
  months: number;
  /** null when the runway is longer than fifty years, where a calendar date
   *  would be noise. */
  depleted_on: string | null;
}

export interface Runway {
  balance_cents: number;
  /** Complete months the whole ledger covers — `normal`'s own sample size.
   *  `essentials`' own sample size lives on `essentials.rate.months`
   *  instead, since it is measured over a different, self-selected set of
   *  months. */
  months_observed: number;
  /** The number of distinct calendar months the ledger's dates touch, from
   *  its first transaction's month to its last's, inclusive. Not the same
   *  claim as `months_observed`: a ledger spanning thirteen calendar months
   *  but measuring only three complete ones looks identical to a dense
   *  three-month ledger unless this field is read alongside it. 0 on an
   *  empty ledger. */
  ledger_span_months: number;
  normal: RunwayScenario | null;
  essentials: RunwayScenario | null;
  /** French. Set exactly when `normal` is null. */
  normal_unavailable_reason: string | null;
  /** French. Set exactly when `essentials` is null — `essentials` is
   *  measured over its own set of months and can fail on its own even when
   *  `normal` succeeds. */
  essentials_unavailable_reason: string | null;
  /** How many categories the reduced scenario rests on. A scenario built on
   *  an empty essential list is not a scenario. */
  essential_category_count: number;
  /** The date `depleted_on` counts forward from — the real calendar date,
   *  unlike `Forecast.projected_from`. */
  projected_from: string;
  ledger_last_on: string | null;
}
