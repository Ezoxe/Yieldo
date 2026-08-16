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
