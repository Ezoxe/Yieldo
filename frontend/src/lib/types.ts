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

// Personal inflation and anomaly detection — mirrors
// backend/app/schemas/analysis.py. Two engines that mostly explain what they
// cannot conclude, so read the field comments before rendering any of it.

export interface CategoryInflation {
  category_id: number | null;
  name: string;
  color: string;
  /**
   * POSITIVE magnitudes — a basket's price is a positive number, and
   * `engines/inflation.py` says so explicitly: this is a named exception to
   * the negative-outflow convention, which is why the fields say `_cost_`.
   *
   * OFTEN NON-ZERO even when `comparable` is false: a category with six
   * months of current spend and none a year earlier still carries its real
   * current-side median here. 0 means "no month with qualifying spend on
   * this side", never a measured cost of zero.
   */
  current_cost_cents: number;
  previous_cost_cents: number;
  /**
   * Signed, current minus previous: positive when this category got more
   * expensive. Populated identically on an incomparable line.
   *
   * NEITHER this field NOR the two costs above may be rendered as a change,
   * a price or a trend when `comparable` is false — the engine's own field
   * docstring is that blunt. `ratio === null` is the only trustworthy signal
   * that no honest comparison exists.
   */
  delta_cents: number;
  /** null — never 0, which would read as "unchanged" — when no honest ratio
   *  exists. */
  ratio: number | null;
  months_current: number;
  months_previous: number;
  comparable: boolean;
  /** French. Non-null exactly when `comparable` is false. */
  reason: string | null;
}

export interface Inflation {
  current_from: string;
  current_to: string;
  previous_from: string;
  previous_to: string;
  /** Steepest rise first among the comparable lines; every incomparable line
   *  falls to the bottom rather than being interleaved as if it were a zero. */
  lines: CategoryInflation[];
  /** Summed over the COMPARABLE lines alone, so on a refusal both are 0 —
   *  which is an absence, not a basket that costs nothing. */
  basket_current_cost_cents: number;
  basket_previous_cost_cents: number;
  basket_ratio: number | null;
  /**
   * The user's own pasted index, over the same two windows. Yieldo fetches
   * nothing, ever. null when no series was entered AND when the series
   * covers only one of the two windows — two different states that a screen
   * has to tell apart, since only the second one means "you already typed
   * something in". Never render it as 0.
   */
  reference_ratio: number | null;
  comparable: boolean;
  reason: string | null;
}

export interface Anomaly {
  transaction_id: number;
  date: string;
  /** Signed, the usual convention: this one IS a transaction amount. */
  amount_cents: number;
  label: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  /**
   * The category's usual amount, as a positive MAGNITUDE — unlike
   * `amount_cents` beside it. Subtracting the two directly is wrong for an
   * expense; the gap is `|‖amount_cents‖ − category_median_cents|`.
   */
  category_median_cents: number;
  /**
   * Iglewicz & Hoaglin's modified z-score. QUALIFIES, DOES NOT ORDER: it
   * decided whether the row crossed the outlier threshold at all, and
   * `AnomalyReport.anomalies` is NOT sorted by it. Two ranking metrics were
   * tried and rejected on this branch before absolute cents was settled on
   * (raw |z| ranked a 15-cent reprice above an 860 EUR spike; a relative
   * ratio ranked a 5 EUR charge on a 1-cent baseline above the same spike).
   * Never present it as a rank, and never re-sort the list.
   */
  modified_z: number;
  direction: "high" | "low";
}

export interface SkippedCategory {
  category_id: number | null;
  name: string;
  /** "expense" or "income" — the SIGN group, not `Anomaly.direction`'s
   *  high/low vocabulary. One category can appear twice, once per side. */
  direction: string;
  observations: number;
  reason: string;
}

export interface AnomalyReport {
  /** Ranked by absolute cents moved, descending. Render as sent. */
  anomalies: Anomaly[];
  /**
   * Window-scoped, exactly like `anomalies`: a group with no transaction
   * inside the reported window appears here not at all, however much history
   * it holds. The MIN_HISTORY decision itself still reads the group's WHOLE
   * history — only whether the outcome is surfaced is gated by the window.
   * So this list must never be described as "judged on the window's rows".
   */
  skipped: SkippedCategory[];
  /** Category+sign groups visible in the window that met the history floor
   *  and were scored — whether or not scoring found anything. Same
   *  window-scoping as `skipped`. 0 can mean "no history anywhere" AND "no
   *  operation at all inside this window"; `skipped` tells them apart. */
  scored_groups: number;
  date_from: string;
  date_to: string;
}

export interface PriceIndexPoint {
  /** "AAAA-MM". */
  month: string;
  /** An index level, not money: 118.42 arrives as 11842. */
  value_hundredths: number;
}

// -- Dettes ------------------------------------------------------------------
//
// Mirrors backend/app/schemas/debts.py. See engines/debt.py for the two
// refusals and for why a constant monthly budget is the whole mechanism.

/** `principal_cents` is a POSITIVE magnitude — capital restant dû. The one
 *  deliberate exception to the negative-means-outflow convention every other
 *  amount in this file follows. Do not negate it for display. */
export interface Debt {
  id: number;
  name: string;
  kind: string;
  principal_cents: number;
  /** Basis points: 490 is 4,90 %/an. A rate is not money — it never goes
   *  through `parseCents`/`formatCents`. */
  annual_rate_bps: number;
  minimum_payment_cents: number;
  term_months: number | null;
  opened_on: string | null;
  archived: boolean;
}

export interface DebtPayoff {
  debt_id: number;
  name: string;
  cleared_in_months: number;
  cleared_on: string;
  interest_cents: number;
  paid_cents: number;
}

export interface BalancePoint {
  month: number;
  on: string;
  /** Keyed by debt id AS A STRING — JSON object keys always are. Every debt in
   *  the plan appears at every point, cleared ones as 0, so a stacked chart has
   *  a value for every series at every x. */
  balances_cents: Record<string, number>;
  total_cents: number;
}

export interface PayoffPlan {
  strategy: string;
  /** Constant for the whole plan: every debt's contractual minimum plus the
   *  extra the household commits. It does not shrink as debts clear. */
  monthly_budget_cents: number;
  /** What every debt costs in interest in month one, together. Published so a
   *  screen can state a budget refusal's shortfall in euros. */
  first_month_interest_cents: number;
  /** null exactly when `unavailable_reason` is set. 0 with a null reason is a
   *  user with no debts — an answer, not a refusal. */
  months: number | null;
  cleared_on: string | null;
  total_interest_cents: number;
  total_paid_cents: number;
  /** Debt ids in attack order. Populated even on a refusal. */
  order: number[];
  payoffs: DebtPayoff[];
  /** Empty on both refusal branches and on an empty debt list. Check `months`
   *  before rendering a chart from it. */
  points: BalancePoint[];
  /** French, from the engine. Print verbatim — it names which of two distinct
   *  causes applies, and paraphrasing is how this project has repeatedly ended
   *  up telling the user the wrong one. */
  unavailable_reason: string | null;
}

export interface StrategyComparison {
  snowball: PayoffPlan;
  avalanche: PayoffPlan;
  /** Snowball's interest minus avalanche's, so a positive value means avalanche
   *  is cheaper. null when either plan refused. 0 is a real answer (one debt, or
   *  two at the same rate), and a NEGATIVE value is one too: rounding each
   *  month's interest to the cent can put avalanche a cent behind. */
  interest_saved_cents: number | null;
  months_saved: number | null;
}

/** What POST /debts and PATCH /debts/{id} accept. Every amount already in
 *  integer cents, every rate already in basis points — the form converts at the
 *  input boundary, nothing downstream re-reads a euro string. */
export interface DebtIn {
  name: string;
  kind: string;
  principal_cents: number;
  annual_rate_bps: number;
  minimum_payment_cents: number;
  term_months: number | null;
  opened_on: string | null;
}

// -- Objectifs ---------------------------------------------------------------
//
// Mirrors backend/app/schemas/goals.py. See engines/goal.py for the sequential
// funding rule and for the FOUR refusals it can emit.

export interface Goal {
  id: number;
  name: string;
  target_cents: number;
  /** DECLARED by the user, never measured: Yieldo cannot tell which euros in a
   *  savings account belong to which goal. It carries no history, which is why
   *  a reached milestone has no date. */
  saved_cents: number;
  due_on: string | null;
  /** Lower is more urgent. Goals are funded one at a time in this order. */
  priority: number;
  archived: boolean;
}

/** Phase 2C's engagement milestones read this shape. */
export interface Milestone {
  percent: number;
  threshold_cents: number;
  reached: boolean;
  /** null on a REACHED milestone — `saved_cents` is declared with no history,
   *  so Yieldo does not know when the threshold was crossed. Rendering today's
   *  date there would claim it happened now. Also null whenever the goal's own
   *  projection refused. */
  months_away: number | null;
  projected_on: string | null;
}

export interface GoalProgress {
  goal_id: number;
  name: string;
  target_cents: number;
  saved_cents: number;
  /** Floored at 0. `progress_ratio` is not clamped and reads above 1 when the
   *  goal is overfunded. */
  remaining_cents: number;
  progress_ratio: number;
  milestones: Milestone[];
  /** Months before this goal receives anything. Say it on screen, or a far-off
   *  date reads as a bug. */
  funding_starts_in_months: number;
  months_to_completion: number | null;
  projected_completion_on: string | null;
  /** French, from the engine. Names WHICH of FOUR causes applies — no
   *  measurable capacity, a capacity that is negative or zero, a projection
   *  past fifty years, or a MORE URGENT goal that is itself unreachable and
   *  holds the whole capacity. Print verbatim; the four remedies are different,
   *  and sending someone to /import to fix a negative capacity is the exact
   *  defect this wording exists to prevent.
   *
   *  (`backend/app/schemas/goals.py` still says "three causes" in its own
   *  comment; `engines/goal.py` emits four — `_reason_blocked_by` is the one
   *  the schema comment predates.) */
  projection_unavailable_reason: string | null;
  due_on: string | null;
  months_until_due: number | null;
  /** THREE states. null is not false: it means no verdict is possible, either
   *  because there is no deadline or because no date could be projected. */
  on_track: boolean | null;
}

export interface GoalReport {
  /** In funding order (priority, then id), not creation order. */
  goals: GoalProgress[];
  /** null below three complete observed months. **Signed** — `median_cents` is
   *  negative for a household spending more than it earns. */
  capacity: MeasuredRate | null;
  months_observed: number;
  history: History | null;
}

/** What POST /goals and PATCH /goals/{id} accept. */
export interface GoalIn {
  name: string;
  target_cents: number;
  saved_cents: number;
  due_on: string | null;
  priority: number;
}

// -- Faisabilité d'achat -----------------------------------------------------
//
// Mirrors backend/app/schemas/feasibility.py. Read `engines/feasibility.py` for
// the ONE refusal this family has (an unmeasurable capacity — a NEGATIVE one is
// a verdict), `engines/levers.py` for the five levers and the cash-versus-credit
// crossover, and `engines/ownership.py` for the cost lines.

/** Every hypothesis actually used, echoed back. Design §10: "Les hypothèses sont
 *  toujours affichées à côté du résultat." */
export interface Assumptions {
  annual_return_bps: number;
  loan_rate_bps: number;
  loan_months: number;
  ownership_years: number;
  /** MEASURED, unlike the four above. null when it could not be measured over
   *  three complete months — in which case there is no debt ratio either. */
  monthly_income_cents: number | null;
  existing_debt_payments_cents: number;
}

export interface CostLine {
  key: string;
  label: string;
  total_cents: number;
  monthly_average_cents: number;
}

export interface Ownership {
  price_cents: number;
  years: number;
  lines: CostLine[];
  depreciation_cents: number;
  residual_value_cents: number;
  /** Running costs ONLY. Depreciation is deliberately not in here: it is value
   *  leaving the asset, not money leaving the account, and a screen adding the
   *  two without saying so compares different things. */
  running_cost_cents: number;
  /** `running_cost_cents + depreciation_cents` — the sum a buyer should weigh. */
  total_cost_cents: number;
  monthly_average_cents: number;
}

export interface EmergencyImpact {
  /** A duration in months, fractional on purpose. Both are `0.0` — not null — on
   *  a balance already below zero, which is the operator's own case: "0,0 mois"
   *  reads as a measurement of nothing and must not be printed. */
  runway_months_before: number | null;
  runway_months_after: number | null;
  /** The measured monthly burn both durations were divided by. Design §10: a
   *  runway of "4 mois" says nothing without the rate behind it. null exactly
   *  when the two months above are, since there was then no burn to quote. */
  monthly_burn_cents: number | null;
  /** French. All three fields above are null exactly when this is set, and it
   *  names WHICH of two causes applies: no measurable expense rate, or a rate
   *  whose median month spends nothing. Print verbatim. */
  unavailable_reason: string | null;
}

export interface Impact {
  emergency: EmergencyImpact;
  /** The LIQUID balance in five years, with and without the purchase. Both null
   *  exactly when `liquid_unavailable_reason` is set. */
  liquid_in_five_years_before_cents: number | null;
  liquid_in_five_years_after_cents: number | null;
  liquid_unavailable_reason: string | null;
  // There is deliberately NO net-worth field and NO health-score field. Design
  // §6.3 item 7 names both; neither exists yet (net worth is phase 3, the
  // evolving health score is phase 2C). The screen states both absences.
}

export type LeverKind = "save_more" | "delay" | "reduce_target" | "borrow" | "cut_category";

/** One way out, with its number. Every field below is populated on EXACTLY ONE
 *  `kind` and null on the other four — `kind` decides which to read. */
export interface Lever {
  kind: LeverKind;
  feasible: boolean;
  /** French. Set exactly when `feasible` is false. Ten distinct wordings across
   *  the five levers; print verbatim, never a shared sentence. */
  unavailable_reason: string | null;
  /** An extra remark on a FEASIBLE lever. Never a substitute for the above. */
  note: string | null;

  // save_more
  extra_monthly_cents: number | null;
  /** The extra as a fraction of the MEASURED capacity. **null when the capacity
   *  is not positive**: a ratio against a negative denominator is not an effort,
   *  it renders as "−540 % d'effort". Print a percentage only when it is set. */
  effort_ratio: number | null;

  // delay
  reached_in_months: number | null;
  delay_months: number | null;

  // reduce_target
  reduced_target_cents: number | null;

  // borrow
  borrow_cents: number | null;
  loan_payment_cents: number | null;
  loan_total_interest_cents: number | null;
  /** null when no income could be measured. Read this BEFORE
   *  `debt_ratio_exceeded`, which is false both under the threshold and when
   *  there is no ratio at all and cannot tell the two apart. */
  debt_ratio_bps: number | null;
  debt_ratio_exceeded: boolean;

  // cut_category
  category_id: number | null;
  category_name: string | null;
  category_median_cents: number | null;
  cut_monthly_cents: number | null;
  /** How many observed months already sat at or below the post-cut level — the
   *  history that says whether the cut is realistic. null on every branch that
   *  proposes no cut, INCLUDING the refusal that still names a category. */
  months_at_or_below: number | null;
  months_observed: number | null;
}

export type FinancingKind = "cash" | "credit" | "loa";

export interface FinancingOption {
  kind: FinancingKind;
  available: boolean;
  unavailable_reason: string | null;
  out_of_pocket_cents: number | null;
  monthly_cents: number | null;
  total_paid_cents: number | null;
  interest_cents: number | null;
  /** Always null on the LOA option, with `wealth_unavailable_reason` saying why.
   *  Never render a null here as zero. */
  wealth_at_end_cents: number | null;
  /** Set exactly when `wealth_at_end_cents` is null on an AVAILABLE option. */
  wealth_unavailable_reason: string | null;
}

export interface Financing {
  /** The LOAN term, not the saving horizon: `assumptions.loan_months`. */
  horizon_months: number;
  options: FinancingOption[];
  break_even_rate_bps: number | null;
  /** French. Set exactly when `break_even_rate_bps` is null. */
  break_even_reason: string | null;
  /** "cash" or "credit". Compares ONLY those two — the LOA line is not in the
   *  running, and the screen must say so rather than implying a three-way
   *  verdict. "cash" ALSO on an exact tie, so read `wealth_gap_cents` first.
   *  null when the credit option could not be priced at all. */
  better_kind: "cash" | "credit" | null;
  /** Credit's end wealth minus cash's, SIGNED. Zero is a tie, which
   *  `better_kind` reports as "cash" and cannot distinguish from a win. null
   *  exactly when `better_kind` is null. */
  wealth_gap_cents: number | null;
}

export type Verdict = "comfortable" | "tight" | "out_of_reach";

export interface Feasibility {
  target_cents: number;
  horizon_months: number;
  down_payment_cents: number;
  nature: string;
  horizon_end_on: string;
  assumptions: Assumptions;

  /** The measured savings capacity behind the verdict, with its band and its
   *  sample size. null below three complete observed months. **Signed** — a
   *  negative `median_cents` is a household spending more than it earns, and it
   *  produces a VERDICT, not a refusal. Never take its absolute value. */
  capacity: MeasuredRate | null;
  /** French. Set exactly when `capacity` is null, and it is the only reason this
   *  endpoint declines to give a verdict. Print verbatim. */
  capacity_unavailable_reason: string | null;
  months_observed: number;
  history: History | null;
  balance_cents: number;

  /** All five null exactly when `capacity_unavailable_reason` is set. */
  verdict: Verdict | null;
  saved_at_horizon_cents: number | null;
  saved_at_horizon_low_cents: number | null;
  /** Published so the screen can tell "dans un bon mois c'est jouable" from
   *  "même un bon mois n'y suffit pas" without a fourth verdict value. */
  saved_at_horizon_high_cents: number | null;
  /** POSITIVE means short, NEGATIVE means a surplus. Branch on the sign —
   *  "il vous manque −866,55 €" is not a sentence. */
  gap_cents: number | null;

  /** Over `opportunity_horizon_months` — the HOLDING period, not the saving
   *  horizon. Never null: nothing about it depends on the capacity. */
  opportunity_cost_cents: number;
  opportunity_horizon_months: number;
  ownership: Ownership;
  impact: Impact;
  /** EMPTY when `capacity` is null. Otherwise exactly five, FEASIBLE FIRST and
   *  then the fixed order save_more, delay, reduce_target, borrow, cut_category
   *  — never ranked by a score. */
  levers: Lever[];
  financing: Financing;
}

/** What one nature prefills, in exactly the shape `POST /feasibility` accepts
 *  back as `ownership_items` — so a form can render them, let the user change
 *  them, and send the edited list without reshaping anything. These are French
 *  averages, not measurements, and every screen showing them says so. */
export interface OwnershipDefaults {
  items: CostItemIn[];
  depreciation_bps_per_year: number;
}

export interface FeasibilityContext {
  capacity: MeasuredRate | null;
  expense_rate: MeasuredRate | null;
  income_rate: MeasuredRate | null;
  months_observed: number;
  history: History | null;
  balance_cents: number;
  existing_debt_payments_cents: number;
  assumptions: Assumptions;
  /** Keyed by nature: "vehicle", "property", "other". "other" prefills nothing
   *  — inventing a fuel budget for a canapé would be a fabricated figure. */
  ownership_defaults: Record<string, OwnershipDefaults>;
  natures: string[];
  default_ownership_years: number;
  default_annual_return_bps: number;
}

/** One overridable running cost. Exactly ONE of the two amounts is set; both, or
 *  neither, is a French 422 from the engine. */
export interface CostItemIn {
  key: string;
  label: string;
  monthly_cents: number | null;
  annual_bps_of_value: number | null;
}

/** A location avec option d'achat, as quoted by a dealer. Every figure comes from
 *  the user: Yieldo has no average for one specific contract. */
export interface LoaIn {
  deposit_cents: number;
  monthly_cents: number;
  months: number;
  residual_cents: number;
}

/** What POST /feasibility accepts. The four assumption overrides are omitted
 *  rather than sent as null when the user leaves the declared default alone. */
export interface FeasibilityRequest {
  target_cents: number;
  horizon_months: number;
  down_payment_cents: number;
  nature: string;
  annual_return_bps?: number;
  loan_rate_bps?: number;
  loan_months?: number;
  ownership_years?: number;
  ownership_items?: CostItemIn[];
  loa?: LoaIn | null;
}

// -- Simulateurs -------------------------------------------------------------
//
// Mirrors backend/app/schemas/simulators.py. Three questions of the "et si"
// kind, answered from figures the user types — unlike `/faisabilite`, which
// answers "puis-je" from figures measured in the ledger. Read
// `engines/amortization.py` for the two refusals a loan carries (a term out of
// range, and an instalment that would not cover the first month's interest),
// `engines/savings.py` for the projection's own term refusal, and
// `engines/property.py` for the rent comparison and its horizon cap.

/** One instalment of an amortisation table. `month` is 1-based: month 1 is the
 *  first instalment, not the day the loan is signed. */
export interface ScheduleRow {
  month: number;
  payment_cents: number;
  interest_cents: number;
  principal_cents: number;
  /** Capital still owed AFTER this instalment. 0 on the last row, always. */
  remaining_cents: number;
}

/** Twelve rows rolled up — one bar of `charts/AmortizationChart`. Computed by
 *  the router, not the engine. The last group may hold fewer than twelve rows
 *  when the term is not a whole number of years, or when the level payment
 *  overshot and repaid the loan early. */
export interface ScheduleYear {
  year: number;
  interest_cents: number;
  principal_cents: number;
  remaining_cents: number;
}

export interface Schedule {
  principal_cents: number;
  annual_rate_bps: number;
  /** The stated term. `rows` is empty when nothing was borrowed, but this still
   *  reports what was asked for — never read 0 here on a zero loan. */
  months: number;
  monthly_payment_cents: number;
  total_paid_cents: number;
  total_interest_cents: number;
  /** Empty exactly when `principal_cents === 0`. Up to 480 rows: a screen
   *  rendering all of them at once renders 480 DOM nodes. */
  rows: ScheduleRow[];
}

/** What POST /simulators/credit accepts. */
export interface CreditRequest {
  principal_cents: number;
  annual_rate_bps: number;
  months: number;
}

export interface CreditSimulation extends Schedule {
  years: ScheduleYear[];
}

/** What POST /simulators/epargne accepts. `monthly_cents` may be NEGATIVE — a
 *  withdrawal plan — and `initial_cents` may be too. Neither is clamped. */
export interface SavingsRequest {
  initial_cents: number;
  monthly_cents: number;
  annual_rate_bps: number;
  months: number;
}

/** Both cumulative from the start of the projection, never per-month, so a
 *  chart can draw the split at any point without summing. */
export interface SavingsPoint {
  month: number;
  contributed_cents: number;
  /** Always ≥ 0: interest accrues only on a positive balance. */
  interest_cents: number;
  /** `initial + contributed + interest`, exactly, at this month. */
  balance_cents: number;
}

export interface SavingsSimulation {
  initial_cents: number;
  monthly_cents: number;
  annual_rate_bps: number;
  months: number;
  final_cents: number;
  contributed_cents: number;
  interest_cents: number;
  points: SavingsPoint[];
}

/** What POST /simulators/immobilier accepts. `monthly_income_cents` and
 *  `existing_debt_payments_cents` are deliberately absent: the route measures
 *  both from the ledger, so the debt ratio it prints is measured, not typed. */
export interface PropertyRequest {
  price_cents: number;
  down_payment_cents: number;
  notary_bps: number;
  loan_rate_bps: number;
  loan_months: number;
  insurance_bps_per_year: number;
  monthly_charges_cents: number;
  annual_property_tax_cents: number;
  /** Absent means NO comparison at all — never a comparison against a rent of
   *  zero. `PropertySimulation.rent_comparison` is then null. */
  monthly_rent_cents?: number;
  years?: number;
  annual_return_bps?: number;
  appreciation_bps_per_year?: number;
}

export interface PropertySimulationDetail {
  price_cents: number;
  notary_fees_cents: number;
  acquisition_cost_cents: number;
  down_payment_cents: number;
  /** How much of the frais de notaire the apport does NOT cover. 0 when it
   *  does. A positive figure is a fact about the plan, reported rather than
   *  refused — a French bank generally wants these paid from own funds. */
  down_payment_short_cents: number;
  borrowed_cents: number;
  schedule: Schedule;
  monthly_insurance_cents: number;
  monthly_charges_cents: number;
  monthly_property_tax_cents: number;
  /** Instalment + assurance + charges + taxe foncière: every recurring euro. */
  monthly_effort_cents: number;
  total_interest_cents: number;
  /** Acquisition + interest + insurance over the loan. Charges and taxe
   *  foncière are NOT in it: an owner and a tenant both pay those. */
  total_cost_cents: number;
  /** null when no income could be measured. Read this BEFORE
   *  `debt_ratio_exceeded`, which is false both under the threshold and when
   *  there is no ratio at all, and cannot tell the two apart. */
  debt_ratio_bps: number | null;
  debt_ratio_exceeded: boolean;
}

export interface RentComparison {
  /** Capped at the loan term. See `capped_reason`. */
  horizon_months: number;
  /** French, set exactly when the requested horizon was cut back to the loan
   *  term. Print verbatim — it says why the cap exists. */
  capped_reason: string | null;
  monthly_rent_cents: number;
  buyer_property_value_cents: number;
  buyer_remaining_loan_cents: number;
  buyer_wealth_cents: number;
  renter_wealth_cents: number;
  /** Buyer minus renter, SIGNED. */
  difference_cents: number;
  /** "buy" or "rent". "buy" ALSO on an exact tie. */
  better_kind: "buy" | "rent";
}

export interface PropertySimulation {
  simulation: PropertySimulationDetail;
  /** null exactly when the request carried no `monthly_rent_cents`. */
  rent_comparison: RentComparison | null;
  /** MEASURED, never typed. null when no income could be measured over three
   *  complete months — in which case there is no debt ratio either. */
  measured_monthly_income_cents: number | null;
  existing_debt_payments_cents: number;
}

/** What the property simulator measures itself, published so the form can show
 *  it before anything is submitted. */
export interface SimulatorContext {
  monthly_income_cents: number | null;
  existing_debt_payments_cents: number;
  months_observed: number;
}

export interface Scenario {
  id: number;
  name: string;
  created_at: string;
  /** Exactly what was saved — the QUESTION, never the answer. */
  request: FeasibilityRequest;
  /** RECOMPUTED against the current ledger on every read, never stored. Two
   *  scenarios listed side by side are therefore always answered from the same
   *  statements, which is what makes them comparable at all. */
  result: Feasibility;
}

// -- Suivi / engagement ------------------------------------------------------
//
// Mirrors backend/app/schemas/engagement.py. Read `engines/streak.py` for what
// "imported" means on a month holding no transaction, `engines/health.py` for
// why an unmeasurable component is NOT a zero, and `engines/challenge.py` for
// the four refusals `measure_outcome` distinguishes.

export interface MonthCovered {
  /** "AAAA-MM". */
  key: string;
  /** Strictly: this month holds at least one transaction. */
  covered: boolean;
  transaction_count: number;
  /** True when `covered`, and also on an EMPTY month some import batch's own
   *  span still reaches — "importé, sans opération". False only on a month no
   *  statement has ever touched. Three states on screen, never two: a month
   *  whose statement arrived and was empty is not the same fact as a month
   *  that was never imported, and the streak counts the first and breaks on
   *  the second. */
  imported: boolean;
}

export interface Streak {
  current: number;
  longest: number;
  /** The most recent PAST month that was imported, "AAAA-MM". */
  last_complete_month: string | null;
  months: MonthCovered[];
  /** French, from the engine. Set exactly when `current === 0`, and it names
   *  WHICH of two causes applies — the follow-up stopped, or it never started.
   *  Print verbatim: the two remedies are not the same. */
  broken_reason: string | null;
}

export interface HealthComponent {
  key: string;
  label: string;
  /** Fixed percentage points out of 100, a property of the score's DESIGN and
   *  not of what could be measured. Present even when the component is
   *  unavailable. */
  weight: number;
  /** 0-100. `null` exactly when `unavailable_reason` is set — and a `null` is
   *  never drawn as a zero-height bar. */
  score: number | null;
  /** The raw figure behind `score`: a ratio of income for the first two, a
   *  month count for runway, a share for budget adherence. */
  measured_value: number | null;
  /** French, from the engine. `null` exactly when `score` is not. */
  unavailable_reason: string | null;
  /** This component's score today minus its own score on the previous STORED
   *  snapshot. `null` when there is no previous snapshot or when either side
   *  could not be measured — a delta between a score and an absence is not a
   *  number. */
  delta_score: number | null;
}

export interface HealthSnapshot {
  /** ISO date. At most one per user per day, written on read. */
  taken_on: string;
  score: number;
}

export interface Health {
  /** 0-100, or `null` below two measurable components. */
  score: number | null;
  components: HealthComponent[];
  /** French. Set exactly when `score` is `null`. */
  unavailable_reason: string | null;
  /** The most recent STORED snapshot strictly before today, never a
   *  recomputation of today's inputs at that date. */
  previous_taken_on: string | null;
  score_delta: number | null;
  /** Every stored snapshot, ascending by date, today's included. A household
   *  reading this screen for the first time has exactly one. */
  history: HealthSnapshot[];
}

export type ChallengeKind =
  | "unused_subscription"
  | "category_above_past_level"
  | "anomaly"
  | "budget_overrun";

export type ChallengeState = "proposed" | "accepted" | "rejected";

export interface Challenge {
  id: number;
  kind: ChallengeKind;
  title: string;
  detail: string;
  /** The figure that JUSTIFIED proposing this challenge — and it means a
   *  different thing per `kind` (a subscription's cost, a category's rise, an
   *  anomaly's excess, a budget's typical overage). Never printed as a bare
   *  amount: the label beside it has to say which. */
  target_cents: number | null;
  category_id: number | null;
  proposed_on: string;
  state: ChallengeState;
  decided_on: string | null;
  /** Positive: the category spent LESS the complete month after acceptance
   *  than the complete month before. Negative: it spent more. */
  measured_cents: number | null;
  measured_on: string | null;
  /** French, from the engine. Set exactly when the challenge is `accepted` and
   *  `measured_cents` is still null; names which of four causes applies. */
  outcome_unavailable_reason: string | null;
}

export interface Engagement {
  streak: Streak;
  /** Milestones across every active goal, in funding order. */
  goals: GoalProgress[];
  health: Health;
  /** Everything ever proposed: `proposed`, then `accepted`, then `rejected`. */
  challenges: Challenge[];
}


// --- /patrimoine: market connections, valuation, allocation ----------------

/** `market.quota` state for one provider. `limit`/`ceiling`/`remaining` are
 *  `null` for a provider with no published limit (Frankfurter) — never a large
 *  integer standing in for "unlimited". */
export interface QuotaState {
  used: number;
  limit: number | null;
  ceiling: number | null;
  remaining: number | null;
  /** ISO datetime, or null when the provider has no window at all. */
  reset_at: string | null;
  can_call: boolean;
}

export type MarketProvider =
  | "finnhub"
  | "alpha_vantage"
  | "coingecko"
  | "frankfurter"
  | "exchangerate_api";

/** `GET /api/connections`. **Carries no key and has nowhere to put one** —
 *  `configured` is the only thing said about whether one exists. */
export interface Connection {
  provider: MarketProvider;
  configured: boolean;
  requires_key: boolean;
  last_used_at: string | null;
  quota: QuotaState;
}

/** `POST /api/connections/{provider}`. The same state `Connection` reports,
 *  plus whether THIS attempt worked. **Still carries no key**: `reason` is one
 *  of `market/client.py`'s five French causes, never the value that was sent.
 *
 *  `valid: false` is a 200, not a failure of the round trip: the provider was
 *  really called and really answered. The screen prints `reason` verbatim —
 *  the five causes name five different remedies, and rewording one here is how
 *  a household ends up told to fix a key when the quota is what ran out. */
export interface ConnectionValidation extends Connection {
  valid: boolean;
  reason: string | null;
}

/** `GET/PUT/DELETE /api/assistant/llm-settings`. **Has nowhere to put a key** —
 *  `has_key` is the only thing said about whether one exists, exactly like
 *  `Connection.configured`. */
export interface LlmSettings {
  configured: boolean;
  endpoint_url: string | null;
  model_name: string | null;
  has_key: boolean;
}

/** A price actually resolved for a position, in the INSTRUMENT'S own currency.
 *
 *  `is_stale` is the whole reason this object exists rather than a bare number:
 *  a stale price is a real answer that still counts toward every total, and it
 *  travels with `fetched_at` so the screen can say how old it is. A price that
 *  could not be fetched at all is `null` here and carries its cause on the
 *  position instead — a different state with a different remedy. */
export interface PriceQuote {
  price_cents: number;
  /** ISO date the price is AS OF (the trading day), not when it was fetched. */
  as_of: string;
  /** ISO datetime the value was actually retrieved from the provider. */
  fetched_at: string;
  source: string;
  is_stale: boolean;
}

export interface PositionValuation {
  position_id: number;
  account_id: number;
  symbol: string;
  name: string;
  asset_class: string;
  /** The instrument's OWN trading currency, not the reporting one. */
  currency: string;
  /** `engines.quantity.Quantity` as text at its canonical 18-decimal scale.
   *  **Not money.** Render it through `formatQuantity`, never `formatCents`. */
  quantity: string;
  cost_basis_cents: number;
  /** `null` exactly when no price could be fetched. */
  price: PriceQuote | null;
  /** French, from `market/client.py`'s five causes. Set exactly when `price`
   *  is null. Printed verbatim — the five name five different remedies. */
  price_unavailable_reason: string | null;
  /** `null` means NOT VALUED — never zero. Native currency. */
  market_value_cents: number | null;
  unrealised_gain_cents: number | null;
  /** French. Set when a conversion was needed and no rate was available: a
   *  cause distinct from a missing price, because the price IS known. */
  fx_unavailable_reason: string | null;
  market_value_reporting_cents: number | null;
  cost_basis_reporting_cents: number | null;
  unrealised_gain_reporting_cents: number | null;
}

/** A share of the portfolio, over WHAT COULD BE VALUED — not over everything.
 *  `weight` is a ratio in 0..1, and 0 when nothing could be valued at all. */
export interface WeightedGroup {
  key: string;
  value_cents: number;
  weight: number;
}

/**
 * The portfolio total, bundled with its own completeness counts.
 *
 * The backend groups them into one object deliberately (`engines/portfolio.py`)
 * so a screen cannot render `market_value_cents` without the counts sitting
 * beside it. **Render both or neither.**
 */
export interface PortfolioTotal {
  market_value_cents: number;
  cost_basis_cents: number;
  unrealised_gain_cents: number;
  positions_total: number;
  positions_valued: number;
  positions_missing_price: number;
  positions_missing_fx: number;
}

export interface PortfolioValuation {
  reporting_currency: string;
  positions: PositionValuation[];
  total: PortfolioTotal;
  weight_by_instrument: WeightedGroup[];
  weight_by_asset_class: WeightedGroup[];
  weight_by_currency: WeightedGroup[];
}

export interface AllocationTarget {
  id: number;
  asset_class: string;
  /** Basis points — 6 000 is 60,00 %. Format with `formatRateBps`. */
  target_bps: number;
}

export interface AssetClassDrift {
  asset_class: string;
  target_bps: number;
  current_bps: number;
  current_value_cents: number;
  target_value_cents: number;
  /** target − current. Positive means underweight (buy), negative overweight. */
  drift_cents: number;
  /** current − target. Positive means overweight. */
  drift_bps: number;
}

export interface Trade {
  symbol: string;
  asset_class: string;
  action: "buy" | "sell";
  /** A QUANTITY as text, whole units when the instrument is not fractionable.
   *  **Not money** — `formatQuantity`, never `formatCents`. */
  quantity: string;
  estimated_value_cents: number;
}

export interface TradeRefusal {
  /** Empty when the refusal is about the asset class as a whole rather than
   *  one instrument. */
  symbol: string;
  asset_class: string;
  /** French, from the engine. Printed verbatim — a refusal is the answer, not
   *  the absence of one. */
  reason: string;
}

export interface AllocationReport {
  /** Over holdings that could be valued, in the reporting currency. */
  total_value_cents: number;
  holdings_total: number;
  holdings_valued: number;
  drifts: AssetClassDrift[];
  trades: Trade[];
  refusals: TradeRefusal[];
}

/** `GET /api/portfolio/allocation`. `report` and `unavailable_reason` are
 *  mutually exclusive and exactly one is always set. */
export interface PortfolioAllocation {
  reporting_currency: string;
  targets: AllocationTarget[];
  report: AllocationReport | null;
  /** French. Set exactly when `report` is null — a household that declared no
   *  target has no drift, and a report of zeroes would be a measurement
   *  nobody made. */
  unavailable_reason: string | null;
}

// --- What `/patrimoine` writes back. Everything above this line is read-only
// --- output the backend computes; everything below is DECLARED by the
// --- household, and each shape mirrors one `schemas/portfolio.py` class.

/** `GET/POST /api/portfolio/accounts`. The envelope a position lives in. */
export interface InvestmentAccount {
  id: number;
  name: string;
  /** One of `models.INVESTMENT_ACCOUNT_KINDS`. */
  kind: string;
  currency: string;
  /** Nullable, and load-bearing for a PEA or an assurance-vie: the French
   *  holding-period rules count from this date, never from a lot's. */
  opened_on: string | null;
  archived: boolean;
}

export interface InvestmentAccountIn {
  name: string;
  kind: string;
  currency: string;
  opened_on: string | null;
}

/** `POST /api/portfolio/instruments` — a find-or-create keyed on
 *  `(symbol, asset_class)`, never an update of an existing row. */
export interface Instrument {
  id: number;
  symbol: string;
  name: string;
  asset_class: string;
  currency: string;
  is_fractionable: boolean;
}

export interface InstrumentIn {
  symbol: string;
  name: string;
  asset_class: string;
  currency: string;
  is_fractionable: boolean;
}

/** `POST /api/portfolio/positions`. Carries no quantity of its own: a position
 *  IS the sum of its lots (`models/position.py`). */
export interface Position {
  id: number;
  investment_account_id: number;
  instrument_id: number;
}

export interface PositionIn {
  investment_account_id: number;
  instrument_id: number;
}

/** One acquisition. `quantity` is an `engines.quantity.Quantity` as text at its
 *  canonical 18-decimal scale — **not money**: `formatQuantity`, never
 *  `formatCents`. `unit_cost_cents` is money, and is. */
export interface Lot {
  id: number;
  position_id: number;
  quantity: string;
  unit_cost_cents: number;
  acquired_on: string;
}

export interface LotIn {
  position_id: number;
  quantity: string;
  unit_cost_cents: number;
  acquired_on: string;
}

/** `PUT /api/portfolio/targets` — the WHOLE set, always. The 100 % invariant
 *  spans rows, so there is no per-row patch to send. */
export interface AllocationTargetIn {
  asset_class: string;
  /** Basis points: 6 000 is 60,00 %. */
  target_bps: number;
}

// --- GET /api/projection (phase 3 Task 15). Monte Carlo, FIRE, French tax and
// --- the three historical stress tests.
//
// **Every panel comes as `<panel> | null` beside a `<panel>_unavailable_reason:
// string | null`, and exactly one of the two is always set.** The operator
// holds zero positions and his measured savings capacity is −746,19 €/month,
// so all four engines refuse on his real data. A refusal is CONTENT on a 200,
// in the panel's own voice — never an alert, and never a zero standing in for
// a figure nobody computed.

/** The hypotheses every figure on the screen rests on — design §10 requires
 *  them printed beside the result they produced.
 *
 *  `seed` is the one field with no everyday French label. It is printed as-is:
 *  the number that reproduces this exact Monte Carlo run, and the number a bug
 *  report quotes. It is a REQUIRED query parameter — the API never invents one. */
export interface ProjectionAssumptions {
  seed: number;
  months: number;
  annual_return_bps: number;
  annual_volatility_bps: number;
  trials: number;
  withdrawal_rate_bps: number;
  /** `null` means the barème option was not priced at all — never that it
   *  costs zero, which is a real (very low) bracket. */
  marginal_rate_bps: number | null;
  joint_taxation: boolean;
  reporting_currency: string;
  horizon_end_on: string;
}

export interface ProjectionPortfolio {
  market_value_cents: number;
  cost_basis_cents: number;
  unrealised_gain_cents: number;
  positions_total: number;
  positions_valued: number;
  positions_missing_price: number;
  positions_missing_fx: number;
  weight_by_asset_class: WeightedGroup[];
}

export interface MonteCarloAssumptions {
  annual_return_bps: number;
  annual_volatility_bps: number;
  /** Signed, exactly as measured. A household spending more than it earns
   *  contributes a NEGATIVE amount and the band goes down — no abs, no clamp. */
  monthly_cents: number;
  trials: number;
  seed: number;
  /** Ascending. The keys of every point's `percentiles_cents`, as numbers. */
  percentiles: number[];
}

export interface MonteCarloPoint {
  month: number;
  /** ISO date this month's point falls on. */
  on: string;
  /** Keyed by percentile, as a STRING key ("10", "50", "90") — JSON has no
   *  integer keys. **Never a single figure**: the band IS the answer. */
  percentiles_cents: Record<string, number>;
}

export interface MonteCarloProjection {
  initial_cents: number;
  months: number;
  assumptions: MonteCarloAssumptions;
  points: MonteCarloPoint[];
  horizon_end_on: string;
}

export interface TargetCapital {
  annual_expenses_cents: number;
  withdrawal_rate_bps: number;
  target_capital_cents: number;
}

export interface Independence {
  target_capital_cents: number;
  current_capital_cents: number;
  withdrawal_rate_bps: number;
  annual_return_bps: number;
  capacity: MeasuredRate | null;
  months_to_independence: number | null;
  independent_on: string | null;
  /** The engine's own sentence, naming WHICH of three causes applies. Set
   *  exactly when `months_to_independence` is null. */
  unavailable_reason: string | null;
}

export interface RetirementPoint {
  month: number;
  balance_cents: number;
  gross_withdrawal_cents: number;
  taxable_gain_cents: number;
  tax_cents: number;
  net_withdrawal_cents: number;
}

export interface RetirementProjection {
  initial_cents: number;
  annual_return_bps: number;
  withdrawal_rate_bps: number;
  /** "pfu" | "bareme" — which regime taxed every withdrawal's gain portion. */
  tax_regime: string;
  marginal_rate_bps: number | null;
  months: number;
  points: RetirementPoint[];
  exhausted_at_month: number | null;
  horizon_end_on: string;
}

export interface FireProjection {
  target: TargetCapital;
  independence: Independence;
  retirement: RetirementProjection | null;
  retirement_unavailable_reason: string | null;
}

/** One regime's answer on one gain. `regime` is never absent — a euro figure
 *  whose tax treatment the reader has to infer from context is exactly the
 *  defect `engines/tax_fr.py` was written against. */
export interface TaxRegimeResult {
  regime: string;
  regime_label: string;
  gross_gain_cents: number;
  income_tax_cents: number;
  social_levies_cents: number;
  total_tax_cents: number;
  net_gain_cents: number;
}

export interface TaxAccount {
  account_id: number;
  account_name: string;
  account_kind: string;
  opened_on: string | null;
  positions_total: number;
  positions_valued: number;
  /** All null together when `unavailable_reason` is set — including `regime`.
   *  A regime without a figure misleads as badly as a figure without a regime. */
  unrealised_gain_cents: number | null;
  regime: string | null;
  regime_label: string | null;
  income_tax_cents: number | null;
  social_levies_cents: number | null;
  total_tax_cents: number | null;
  net_gain_cents: number | null;
  /** PEA only. */
  exempt: boolean | null;
  /** PEA and assurance-vie only. */
  years_held: number | null;
  /** Assurance-vie only, against the INCOME TAX base alone. */
  abatement_applied_cents: number | null;
  /** The barème priced on the identical gain, when a marginal rate was
   *  supplied. `null` means it was never asked for — never that it costs zero. */
  alternative: TaxRegimeResult | null;
  unavailable_reason: string | null;
}

export interface TaxReport {
  total_unrealised_gain_cents: number;
  total_tax_cents: number;
  accounts_unavailable: number;
  accounts: TaxAccount[];
  /** "pfu" | "bareme" on the aggregate, or null when no marginal rate was
   *  supplied. Facts side by side, never a recommendation. */
  cheaper: string | null;
}

/** A named historical episode: its period and its published source travel with
 *  every figure it produced. **None of this is a forecast.** */
export interface StressShock {
  key: string;
  label: string;
  period: string;
  source: string;
  impact_bps_by_asset_class: Record<string, number>;
}

export interface StressClassImpact {
  asset_class: string;
  current_value_cents: number;
  /** Both null together when this shock has no data for the class — Bitcoin in
   *  2008, an ETF in any of the three. Never folded in at 0 %. */
  impact_bps: number | null;
  stressed_value_cents: number | null;
}

export interface StressScenario {
  shock: StressShock;
  portfolio_value_cents: number;
  stressable_value_cents: number;
  stressed_value_cents: number;
  impact_cents: number;
  impact_bps: number;
  by_class: StressClassImpact[];
  classes_without_data: string[];
}

/** `shocks` is always the three episodes with their periods and sources, even
 *  when `scenarios` is empty: those citations are facts about market history,
 *  not about this household's portfolio. */
export interface StressReport {
  shocks: StressShock[];
  scenarios: StressScenario[];
}

export interface Projection {
  as_of: string;
  reporting_currency: string;
  assumptions: ProjectionAssumptions;
  months_observed: number;
  capacity: MeasuredRate | null;
  capacity_unavailable_reason: string | null;
  expense_rate: MeasuredRate | null;
  portfolio: ProjectionPortfolio;

  monte_carlo: MonteCarloProjection | null;
  monte_carlo_unavailable_reason: string | null;

  fire: FireProjection | null;
  fire_unavailable_reason: string | null;

  tax: TaxReport | null;
  tax_unavailable_reason: string | null;

  stress: StressReport;
  stress_unavailable_reason: string | null;
}

// -- /api/chat -- the deterministic assistant. Design §8.1. ------------------

/** One column of a bar chart, or one reading of a line. `label` arrives ready
 *  to display, in French — nothing on the client reformats it. */
export interface ChatChartPoint {
  label: string;
  amount_cents: number;
}

/** The decomposition of the figure an answer quotes. `ChatAnswer.chart` is
 *  `null` whenever there is nothing to decompose — a refusal, or an intent
 *  whose answer a chart could only decorate. Never an empty `points` array
 *  standing in for that. */
export interface ChatChart {
  kind: "bars" | "line";
  title: string;
  points: ChatChartPoint[];
}

export interface ChatAnswer {
  /** `false` when the question could not be parsed at all. `query_description`
   *  is then null and `supported_formulations` carries the ten phrasings the
   *  parser does understand. */
  recognised: boolean;
  /** The executed query, in clear French. Design §8.1 requires it beside every
   *  answer so the figure can be checked against what was actually computed. */
  query_description: string | null;
  text: string;
  amount_cents: number | null;
  /** An engine declining to compute. It travels through unchanged — never
   *  softened, never rephrased, never wrapped in reassurance. */
  is_refusal: boolean;
  supported_formulations: string[] | null;
  chart: ChatChart | null;
}

export interface ChatMessage {
  id: number;
  text: string;
  created_at: string;
  /** Always freshly computed: the server stores the QUESTION and re-executes
   *  it against the current ledger on every read. */
  answer: ChatAnswer;
}

// -- /api/export -- the filterable context export. Design §8.2. -------------

export type ExportGranularity = "annual" | "monthly" | "transaction";
export type ExportFormat = "md" | "txt" | "json";

export interface ExportScopeRequest {
  date_from: string | null;
  date_to: string | null;
  /** `null` means every account; `[]` means none. The two are different
   *  scopes and the API keeps them apart. */
  account_ids: number[] | null;
  category_ids: number[] | null;
  granularity: ExportGranularity;
  modules: string[];
  anonymise: boolean;
  /** `null` means no target was named: the answer then carries an estimate
   *  with no verdict, never a verdict against a model nobody chose. */
  target_model: string | null;
}

export interface ExportDocument {
  markdown: string;
  estimated_tokens: number;
  warning: string | null;
  transaction_count: number;
  excluded_transfer_count: number;
  date_from: string;
  date_to: string;
  sections: string[];
}

export interface ExportFile {
  filename: string;
  content_type: string;
  content: string;
}

export interface ExportTemplate {
  key: string;
  label: string;
  summary: string;
  /** The question to put to the model, carried with the scope it belongs to. */
  question: string;
  date_from: string;
  date_to: string;
  granularity: ExportGranularity;
  modules: string[];
  anonymise: boolean;
}

export interface ExportOptions {
  accounts: { id: number; name: string; kind: string }[];
  categories: { id: number; name: string }[];
  modules: { key: string; label: string }[];
  target_models: { key: string; label: string; context_tokens: number }[];
  /** Both null for a household that has imported nothing — never a made-up
   *  span, and never today standing in for a ledger that does not exist. */
  ledger_date_from: string | null;
  ledger_date_to: string | null;
}
