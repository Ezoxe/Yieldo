/**
 * Development-only fetch stub — never bundled behaviour in production.
 *
 * Installed from main.tsx when, and only when, `import.meta.env.DEV` is true
 * and the tab carries the `?apercu=1` flag (stored in sessionStorage so it
 * survives client-side navigation). It answers the read endpoints of the main
 * screens with a coherent, hand-built French ledger so the interface can be
 * looked at in a browser without a backend, a database or an account.
 *
 * It is a *viewing* harness, not a test double: nothing here is asserted on,
 * and it is deliberately absent from the test setup.
 */

import { CONNECTIONS as MARKET_CONNECTIONS, LLM_LOCAL } from "../features/connections/fixtures";
import type { LlmSettings } from "../lib/types";

const FLAG = "yd-apercu";

export function shouldMockApi(): boolean {
  if (!import.meta.env.DEV) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("apercu") === "1") sessionStorage.setItem(FLAG, "1");
  if (params.get("apercu") === "0") sessionStorage.removeItem(FLAG);
  return sessionStorage.getItem(FLAG) === "1";
}

/* -- The ledger ----------------------------------------------------------- */

const CATEGORIES = [
  { id: 1, name: "Logement", slug: "logement", color: "#3b82f6", budget: 95000 },
  { id: 2, name: "Alimentation", slug: "alimentation", color: "#4fd6a8", budget: 45000 },
  { id: 3, name: "Transport", slug: "transport", color: "#f4a261", budget: 18000 },
  { id: 4, name: "Abonnements", slug: "abonnements", color: "#7ee2d6", budget: 6000 },
  { id: 5, name: "Restaurants", slug: "restaurants", color: "#f472b6", budget: 16000 },
  { id: 6, name: "Santé", slug: "sante", color: "#e5606b", budget: 8000 },
  { id: 7, name: "Loisirs", slug: "loisirs", color: "#a78bfa", budget: 12000 },
  { id: 8, name: "Divers", slug: "divers", color: "#94a3b8", budget: null },
  { id: 9, name: "Salaire", slug: "salaire", color: "#22c55e", budget: null },
];

const MONTHS = [
  "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
];

const TODAY = "2026-09-03";

/** Deterministic pseudo-random in [0,1) — the harness must look the same twice. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

interface Row {
  id: number;
  date: string;
  amount_cents: number;
  label: string;
  category_id: number;
}

const LABELS: Record<number, string[]> = {
  1: ["VIR SEPA LOYER APPARTEMENT", "PRLV EDF ELECTRICITE", "PRLV ASSURANCE HABITATION"],
  2: ["CB CARREFOUR MARKET", "CB BIOCOOP", "CB LIDL", "CB BOULANGERIE MARTIN"],
  3: ["CB TOTAL ENERGIES STATION", "PRLV NAVIGO", "CB PEAGE APRR"],
  4: ["PRLV SPOTIFY AB", "PRLV NETFLIX", "PRLV FREE MOBILE", "PRLV OVH HEBERGEMENT"],
  5: ["CB LE COMPTOIR", "CB PIZZERIA DA MARCO", "CB SUSHI SHOP"],
  6: ["CB PHARMACIE DU CENTRE", "VIR DR LEROY CONSULTATION"],
  7: ["CB FNAC", "CB DECATHLON", "CB CINEMA UGC"],
  8: ["VIR INSTANTANE EMIS POUR: Marc AURIAU", "PRLV EUROPEEN PAYPAL EUROPE", "RETRAIT DAB"],
  9: ["VIR SALAIRE MENSUEL SOCIETE NOVA"],
};

const ROWS: Row[] = (() => {
  const rows: Row[] = [];
  let id = 1;
  MONTHS.forEach((month, mi) => {
    const dim = daysInMonth(month);
    // Le salaire, en premier de chaque mois.
    rows.push({
      id: id++,
      date: `${month}-02`,
      amount_cents: 298000 + Math.round(rand(mi + 1) * 24000),
      label: LABELS[9][0],
      category_id: 9,
    });
    for (let i = 0; i < 26; i += 1) {
      const seed = mi * 100 + i + 7;
      const category = CATEGORIES[Math.floor(rand(seed) * 8)];
      const labels = LABELS[category.id];
      const day = 1 + Math.floor(rand(seed * 3) * (dim - 1));
      const base = { 1: 42000, 2: 4800, 3: 3600, 4: 1200, 5: 3200, 6: 2600, 7: 4400, 8: 5200 }[
        category.id as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
      ];
      rows.push({
        id: id++,
        date: `${month}-${String(day).padStart(2, "0")}`,
        amount_cents: -Math.round(base * (0.5 + rand(seed * 5) * 1.4)),
        label: labels[Math.floor(rand(seed * 7) * labels.length)],
        category_id: category.id,
      });
    }
  });
  // Deux valeurs aberrantes assumées, pour que l'écran Analyse ait à dire quelque chose.
  rows.push({ id: id++, date: "2026-03-03", amount_cents: -60901, label: LABELS[8][0], category_id: 8 });
  rows.push({ id: id++, date: "2026-07-17", amount_cents: -14999, label: LABELS[8][1], category_id: 8 });
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
})();

function inRange(row: Row, from?: string | null, to?: string | null): boolean {
  if (from && row.date < from) return false;
  if (to && row.date > to) return false;
  return true;
}

function totalsFor(from?: string | null, to?: string | null) {
  const rows = ROWS.filter((row) => inRange(row, from, to));
  const inflow = rows.filter((r) => r.amount_cents > 0).reduce((s, r) => s + r.amount_cents, 0);
  const outflow = rows.filter((r) => r.amount_cents < 0).reduce((s, r) => s + r.amount_cents, 0);
  const dates = rows.map((r) => r.date).sort();
  return {
    date_from: from || dates[0] || "2025-10-01",
    date_to: to || dates[dates.length - 1] || TODAY,
    inflow_cents: inflow,
    outflow_cents: outflow,
    net_cents: inflow + outflow,
    transaction_count: rows.length,
    savings_rate: inflow > 0 ? (inflow + outflow) / inflow : null,
  };
}

const HISTORY = {
  date_from: ROWS[ROWS.length - 1].date,
  date_to: ROWS[0].date,
  transaction_count: ROWS.length,
};

const CATEGORY_PAYLOAD = CATEGORIES.map((c) => ({
  id: c.id,
  parent_id: null,
  name: c.name,
  slug: c.slug,
  kind: c.id === 9 ? "income" : "expense",
  color: c.color,
  icon: c.slug,
  monthly_budget_cents: c.budget,
  is_essential: [1, 2, 3, 6].includes(c.id),
}));

/* -- Endpoint table ------------------------------------------------------- */

type Params = URLSearchParams;

function bucket(start: string, end: string, key: string) {
  const totals = totalsFor(start, end);
  return {
    key,
    start,
    end,
    inflow_cents: totals.inflow_cents,
    outflow_cents: totals.outflow_cents,
    net_cents: totals.net_cents,
    count: totals.transaction_count,
  };
}

/** Honours `granularity`, like the real route: a one-month range asked for in
 *  daily buckets must come back with thirty of them, not one. */
function seriesFor(params: Params) {
  const from = params.get("date_from");
  const to = params.get("date_to");
  const granularity = params.get("granularity") ?? "month";

  if (granularity === "day" || granularity === "week") {
    const step = granularity === "day" ? 1 : 7;
    const first = Date.parse(from ?? `${MONTHS[0]}-01`);
    const last = Date.parse(to ?? `${MONTHS[MONTHS.length - 1]}-28`);
    const out = [];
    for (let t = first; t <= last; t += step * 86_400_000) {
      const start = new Date(t).toISOString().slice(0, 10);
      const end = new Date(Math.min(t + (step - 1) * 86_400_000, last)).toISOString().slice(0, 10);
      out.push(bucket(start, end, start));
    }
    return out;
  }

  const months = MONTHS.filter((m) => (!from || m >= from.slice(0, 7)) && (!to || m <= to.slice(0, 7)));
  return months.map((month) =>
    bucket(`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, "0")}`, month),
  );
}

function breakdownFor(params: Params) {
  const from = params.get("date_from");
  const to = params.get("date_to");
  const rows = ROWS.filter((r) => inRange(r, from, to) && r.amount_cents < 0);
  const total = rows.reduce((s, r) => s + r.amount_cents, 0);
  return CATEGORIES.filter((c) => c.id !== 9)
    .map((c) => {
      const own = rows.filter((r) => r.category_id === c.id);
      const sum = own.reduce((s, r) => s + r.amount_cents, 0);
      return {
        category_id: c.id,
        name: c.name,
        color: c.color,
        total_cents: sum,
        count: own.length,
        share: total === 0 ? 0 : sum / total,
      };
    })
    .filter((line) => line.count > 0)
    .sort((a, b) => a.total_cents - b.total_cents);
}

function calendarFor(params: Params) {
  const from = params.get("date_from");
  const to = params.get("date_to");
  const byDate = new Map<string, { inflow: number; outflow: number; count: number }>();
  for (const row of ROWS.filter((r) => inRange(r, from, to))) {
    const point = byDate.get(row.date) ?? { inflow: 0, outflow: 0, count: 0 };
    if (row.amount_cents > 0) point.inflow += row.amount_cents;
    else point.outflow += row.amount_cents;
    point.count += 1;
    byDate.set(row.date, point);
  }
  return [...byDate.entries()].map(([date, p]) => ({
    date,
    inflow_cents: p.inflow,
    outflow_cents: p.outflow,
    net_cents: p.inflow + p.outflow,
    count: p.count,
  }));
}

function summaryFor(params: Params) {
  const from = params.get("date_from");
  const to = params.get("date_to");
  const current = totalsFor(from, to);
  const span = from && to ? Date.parse(to) - Date.parse(from) : null;
  const previous =
    from && to && span !== null
      ? totalsFor(
          new Date(Date.parse(from) - span - 86_400_000).toISOString().slice(0, 10),
          new Date(Date.parse(from) - 86_400_000).toISOString().slice(0, 10),
        )
      : null;
  return {
    ...current,
    previous,
    comparison: previous
      ? {
          delta_cents: current.net_cents - previous.net_cents,
          delta_ratio: previous.net_cents === 0 ? null : (current.net_cents - previous.net_cents) / Math.abs(previous.net_cents),
        }
      : null,
    history: HISTORY,
  };
}

function transactionsFor(params: Params) {
  const from = params.get("date_from");
  const to = params.get("date_to");
  const limit = Number(params.get("limit") ?? 50);
  const offset = Number(params.get("offset") ?? 0);
  const rows = ROWS.filter((r) => inRange(r, from, to));
  return {
    items: rows.slice(offset, offset + limit).map((row) => ({
      id: row.id,
      account_id: 1,
      date: row.date,
      value_date: null,
      amount_cents: row.amount_cents,
      label_raw: row.label,
      label_clean: row.label,
      category_id: row.category_id,
      category_source: row.id % 5 === 0 ? "user" : "rule",
      is_transfer: false,
      is_recurring: row.category_id === 4 || row.category_id === 1,
      notes: null,
      tags: [],
    })),
    total: rows.length,
    limit,
    offset,
    period_total: rows.length,
    history: HISTORY,
  };
}

function budgetsFor(params: Params) {
  const month = params.get("month") ?? "2026-08";
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const rows = ROWS.filter((r) => inRange(r, start, end) && r.amount_cents < 0);
  const lines = CATEGORIES.filter((c) => c.budget !== null).map((c) => {
    const spent = rows.filter((r) => r.category_id === c.id).reduce((s, r) => s + r.amount_cents, 0);
    const budget = c.budget as number;
    const ratio = Math.abs(spent) / budget;
    return {
      category_id: c.id,
      name: c.name,
      color: c.color,
      is_essential: [1, 2, 3, 6].includes(c.id),
      budget_cents: budget,
      spent_cents: spent,
      remaining_cents: budget + spent,
      consumed_ratio: ratio,
      projected_cents: Math.round(spent * 1.05),
      status: ratio > 1 ? "over" : ratio > 0.85 ? "at_risk" : "ok",
    };
  });
  return {
    month,
    month_start: start,
    month_end: end,
    days_elapsed: daysInMonth(month),
    days_in_month: daysInMonth(month),
    is_current_month: false,
    lines,
    unbudgeted: [
      { category_id: 8, name: "Divers", color: "#94a3b8", spent_cents: -18400 },
    ],
    total_budget_cents: lines.reduce((s, l) => s + l.budget_cents, 0),
    total_spent_cents: lines.reduce((s, l) => s + l.spent_cents, 0),
    history: HISTORY,
  };
}

const RECURRENCES = [
  { label: "PRLV SPOTIFY AB", cat: 4, amount: -1199, per: "monthly" },
  { label: "PRLV NETFLIX", cat: 4, amount: -1549, per: "monthly" },
  { label: "PRLV FREE MOBILE", cat: 4, amount: -1999, per: "monthly" },
  { label: "VIR SEPA LOYER APPARTEMENT", cat: 1, amount: -85000, per: "monthly" },
  { label: "PRLV NAVIGO", cat: 3, amount: -8820, per: "monthly" },
  { label: "PRLV OVH HEBERGEMENT", cat: 4, amount: -7188, per: "yearly" },
];

function recurrencesPayload() {
  const recurrences = RECURRENCES.map((r, i) => {
    const category = CATEGORIES.find((c) => c.id === r.cat)!;
    const perYear = r.per === "monthly" ? 12 : 1;
    return {
      label: r.label,
      label_key: r.label.toLowerCase(),
      category_id: category.id,
      category_name: category.name,
      category_color: category.color,
      periodicity: r.per,
      occurrences: r.per === "monthly" ? 11 : 2,
      first_on: "2025-10-05",
      last_on: "2026-08-05",
      median_interval_days: r.per === "monthly" ? 30 : 365,
      amount_cents: r.amount,
      amount_spread_cents: 0,
      annual_cents: r.amount * perYear,
      observed_span_days: 320,
      annualisable: true,
      expected_next_on: "2026-09-05",
      status: i === 4 ? "missing" : "active",
      confidence: i < 3 ? "confirmed" : "probable",
      price_change:
        i === 1
          ? { previous_cents: -1399, current_cents: -1549, changed_on: "2026-05-05", ratio: 0.107 }
          : null,
    };
  });
  const annual = recurrences.reduce((s, r) => s + r.annual_cents, 0);
  return {
    recurrences,
    annual_subscription_cents: annual,
    monthly_subscription_cents: Math.round(annual / 12),
    analysed_groups: 34,
    rejected_thin: 19,
    rejected_irregular: 9,
    notice: null,
    missing_count: 1,
    price_change_count: 1,
    ledger_last_on: "2026-08-31",
  };
}

function inflationPayload() {
  const lines = CATEGORIES.filter((c) => c.id !== 9).map((c, i) => {
    const comparable = i < 5;
    const previous = 20000 + i * 4000;
    const current = Math.round(previous * (1 + (rand(i + 3) - 0.35) * 0.4));
    return {
      category_id: c.id,
      name: c.name,
      color: c.color,
      current_cost_cents: current,
      previous_cost_cents: previous,
      delta_cents: current - previous,
      ratio: comparable ? (current - previous) / previous : null,
      months_current: comparable ? 6 : 1,
      months_previous: comparable ? 6 : 0,
      comparable,
      reason: comparable ? null : "Moins de trois mois comparables de part et d'autre.",
    };
  });
  const comparable = lines.filter((l) => l.comparable);
  const current = comparable.reduce((s, l) => s + l.current_cost_cents, 0);
  const previous = comparable.reduce((s, l) => s + l.previous_cost_cents, 0);
  return {
    current_from: "2026-03-01",
    current_to: "2026-08-31",
    previous_from: "2025-03-01",
    previous_to: "2025-08-31",
    lines: lines.sort((a, b) => (b.ratio ?? -9) - (a.ratio ?? -9)),
    basket_current_cost_cents: current,
    basket_previous_cost_cents: previous,
    basket_ratio: (current - previous) / previous,
    reference_ratio: 0.021,
    comparable: true,
    reason: null,
  };
}

function anomaliesPayload() {
  const picks = ROWS.filter((r) => r.amount_cents < -12000).slice(0, 6);
  return {
    anomalies: picks.map((row) => {
      const category = CATEGORIES.find((c) => c.id === row.category_id)!;
      return {
        transaction_id: row.id,
        date: row.date,
        amount_cents: row.amount_cents,
        label: row.label,
        category_id: category.id,
        category_name: category.name,
        category_color: category.color,
        category_median_cents: 2600,
        modified_z: 6.4,
        direction: "high",
      };
    }),
    skipped: [
      { category_id: 6, name: "Santé", direction: "expense", observations: 4, reason: "Moins de huit opérations dans l'historique." },
      { category_id: 9, name: "Salaire", direction: "income", observations: 11, reason: "Montants trop réguliers pour qu'un écart ait un sens." },
    ],
    scored_groups: 7,
    date_from: "2026-03-01",
    date_to: "2026-08-31",
  };
}

function forecastPayload() {
  const months = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"];
  let balance = 412_000;
  return {
    months: months.map((key, i) => {
      const net = 28000 - i * 6400;
      balance += net;
      return {
        key,
        start: `${key}-01`,
        end: `${key}-${daysInMonth(key)}`,
        recurring_cents: -116_755,
        residual_cents: net + 116_755,
        net_p50_cents: net,
        balance_p10_cents: balance - 62_000,
        balance_p50_cents: balance,
        balance_p90_cents: balance + 58_000,
        below_threshold: balance - 62_000 < 50_000,
        seasonal: i === 3,
      };
    }),
    months_observed: 11,
    ledger_months_observed: 11,
    seasonality_used: true,
    recurrences_projected: 6,
    threshold_cents: 50_000,
    first_breach_key: null,
    opening_balance_cents: 412_000,
    insufficient_reason: null,
    projected_from: "2026-08-31",
    ledger_last_on: "2026-08-31",
    pooled_scale_cents: 62_000,
    seasonal_scale_cents: 48_000,
  };
}

function rate(months: number, median: number) {
  return { months, median_cents: median, spread_cents: 42_000, low_cents: median - 62_000, high_cents: median + 58_000 };
}

function runwayPayload() {
  return {
    balance_cents: 412_000,
    months_observed: 11,
    ledger_span_months: 11,
    normal: { name: "normal", monthly_burn_cents: -184_000, rate: rate(11, -184_000), months: 2.2, depleted_on: "2026-11-09" },
    essentials: { name: "essentials", monthly_burn_cents: -132_000, rate: rate(9, -132_000), months: 3.1, depleted_on: "2026-12-06" },
    normal_unavailable_reason: null,
    essentials_unavailable_reason: null,
    essential_category_count: 4,
    projected_from: TODAY,
    ledger_last_on: "2026-08-31",
  };
}

const DEBTS = [
  { id: 1, name: "Prêt auto", kind: "auto", principal_cents: 780_000, annual_rate_bps: 390, minimum_payment_cents: 24_500, term_months: 36, opened_on: "2025-02-01", archived: false },
  { id: 2, name: "Crédit conso travaux", kind: "conso", principal_cents: 315_000, annual_rate_bps: 690, minimum_payment_cents: 13_000, term_months: 30, opened_on: "2025-06-15", archived: false },
  { id: 3, name: "Découvert autorisé", kind: "revolving", principal_cents: 62_000, annual_rate_bps: 1490, minimum_payment_cents: 4_000, term_months: null, opened_on: null, archived: false },
];

function plan(strategy: string, order: number[]) {
  const points = Array.from({ length: 25 }, (_, month) => {
    const balances: Record<string, number> = {};
    let total = 0;
    DEBTS.forEach((debt) => {
      const left = Math.max(0, debt.principal_cents - month * (debt.principal_cents / 24));
      balances[String(debt.id)] = Math.round(left);
      total += left;
    });
    return { month, on: `2026-${String(9 + (month % 4)).padStart(2, "0")}-01`, balances_cents: balances, total_cents: Math.round(total) };
  });
  return {
    strategy,
    monthly_budget_cents: 61_500,
    first_month_interest_cents: 4_120,
    months: 24,
    cleared_on: "2028-09-01",
    total_interest_cents: strategy === "avalanche" ? 68_400 : 74_900,
    total_paid_cents: 1_225_000,
    order,
    payoffs: DEBTS.map((debt, i) => ({
      debt_id: debt.id,
      name: debt.name,
      cleared_in_months: 8 + i * 7,
      cleared_on: `2027-0${1 + i}-01`,
      interest_cents: 12_000 + i * 9_000,
      paid_cents: debt.principal_cents + 12_000,
    })),
    points,
    unavailable_reason: null,
  };
}

function goalsPayload() {
  const goals = [
    { id: 1, name: "Fonds d'urgence", target_cents: 900_000, saved_cents: 412_000, due_on: "2027-06-30", priority: 1 },
    { id: 2, name: "Remplacement voiture", target_cents: 1_200_000, saved_cents: 180_000, due_on: null, priority: 2 },
    { id: 3, name: "Voyage Japon", target_cents: 450_000, saved_cents: 96_000, due_on: "2027-04-01", priority: 3 },
  ];
  return {
    goals: goals.map((goal, i) => ({
      goal_id: goal.id,
      name: goal.name,
      target_cents: goal.target_cents,
      saved_cents: goal.saved_cents,
      remaining_cents: goal.target_cents - goal.saved_cents,
      progress_ratio: goal.saved_cents / goal.target_cents,
      milestones: [25, 50, 75, 100].map((percent) => {
        const threshold = Math.round((goal.target_cents * percent) / 100);
        const reached = goal.saved_cents >= threshold;
        return {
          percent,
          threshold_cents: threshold,
          reached,
          months_away: reached ? null : 4 + percent / 25,
          projected_on: reached ? null : `2027-0${1 + Math.floor(percent / 40)}-01`,
        };
      }),
      funding_starts_in_months: i * 9,
      months_to_completion: 12 + i * 9,
      projected_completion_on: `2027-0${1 + i}-01`,
      reason: null,
    })),
    capacity: rate(11, 42_000),
    months_observed: 11,
    history: HISTORY,
  };
}

const ROUTES: Record<string, (params: Params) => unknown> = {
  "/api/auth/refresh": () => ({ access_token: "apercu", token_type: "bearer", user: MUTABLE_USER }),
  "/api/auth/me": () => MUTABLE_USER,
  "/api/access-key": () => {
    // A read issues one when there is none, and never rotates an existing one
    // — the same contract the backend route documents.
    agentKey = agentKey ?? mintAgentKey();
    return agentKey;
  },
  "/api/categories": () => CATEGORY_PAYLOAD,
  "/api/accounts": () => [
    { id: 1, name: "Compte courant", kind: "checking", currency: "EUR", opening_balance_cents: 412_000, opened_on: "2025-09-01", include_in_net_worth: true, archived: false },
    { id: 2, name: "Livret A", kind: "savings", currency: "EUR", opening_balance_cents: 1_240_000, opened_on: "2023-01-01", include_in_net_worth: true, archived: false },
  ],
  "/api/analytics/summary": summaryFor,
  "/api/analytics/series": seriesFor,
  "/api/analytics/categories": breakdownFor,
  "/api/analytics/calendar": calendarFor,
  "/api/transactions": transactionsFor,
  "/api/budgets": budgetsFor,
  "/api/recurrences": recurrencesPayload,
  "/api/analysis/inflation": inflationPayload,
  "/api/analysis/anomalies": anomaliesPayload,
  "/api/analysis/price-index": () => [],
  "/api/cashflow/forecast": forecastPayload,
  "/api/cashflow/runway": runwayPayload,
  "/api/debts": () => DEBTS,
  "/api/debts/payoff": () => ({
    snowball: plan("snowball", [3, 2, 1]),
    avalanche: plan("avalanche", [3, 2, 1]),
    interest_saved_cents: 6_500,
    months_saved: 1,
  }),
  "/api/goals": goalsPayload,
  "/api/chat": () => MOCK_CHATS,
  "/api/chat/conversations": () => mockConversations(),
  // Réglages → Connexions. Un modèle local configuré, avec un plafond relevé :
  // c'est l'état intéressant à regarder, celui d'un foyer qui a un modèle qui
  // raisonne et l'a dit.
  "/api/connections": () => MARKET_CONNECTIONS,
  "/api/assistant/llm-settings": () => MUTABLE_LLM,
  "/api/engagement": () => ({
    streak: {
      current: 7,
      longest: 9,
      last_complete_month: "2026-08",
      months: MONTHS.map((key, index) => ({
        key,
        covered: index > 1,
        transaction_count: index > 1 ? 27 : 0,
        imported: index > 0,
      })),
      broken_reason: null,
    },
    goals: goalsPayload().goals,
    health: {
      score: 32,
      components: [
        { key: "savings_rate", label: "Taux d'épargne", weight: 30, score: 12, measured_value: -0.075, unavailable_reason: null, delta_score: -4 },
        { key: "runway", label: "Autonomie", weight: 25, score: 38, measured_value: 2.2, unavailable_reason: null, delta_score: 2 },
        { key: "essentials", label: "Part des dépenses essentielles", weight: 25, score: 46, measured_value: 0.61, unavailable_reason: null, delta_score: 0 },
        { key: "budget", label: "Respect des budgets", weight: 20, score: null, measured_value: null, unavailable_reason: "Moins de trois mois de budgets définis.", delta_score: null },
      ],
      unavailable_reason: null,
      previous_taken_on: "2026-08-28",
      score_delta: -3,
      history: [
        { taken_on: "2026-06-30", taken: 0, score: 41 },
        { taken_on: "2026-07-31", score: 38 },
        { taken_on: "2026-08-28", score: 35 },
        { taken_on: TODAY, score: 32 },
      ].map(({ taken_on, score }) => ({ taken_on, score })),
    },
    challenges: [],
  }),
};

/**
 * Endpoints that WRITE. Keyed by method and path, checked before the read table
 * so a PATCH and a GET on the same path do not collide. The harness keeps the
 * change in memory for the rest of the tab, which is enough to see the screen
 * behave — it is not a database.
 */
const MUTABLE_USER = { id: 1, email: "apercu@yieldo.local", name: "Maxime", role: "owner" };

/** The harness's own agent key, with the same 24-hour shape the backend gives
 *  it. Held in memory for the tab: enough to see the panel behave. */
function mintAgentKey() {
  const now = new Date();
  const hex = (bytes: number) =>
    Array.from(
      { length: bytes * 2 },
      (_, i) => "0123456789abcdef"[Math.floor(rand(i + now.getTime() / 1000) * 16)],
    ).join("");
  return {
    key: `yld_${hex(6)}_${hex(32)}`,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
    last_used_at: null as string | null,
  };
}

let agentKey: ReturnType<typeof mintAgentKey> | null = null;

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Les vraies formes, importées plutôt que réécrites : une CONNECTIONS
// inventée ici a fait planter ProviderCard sur un `quota` null qui n'existe
// dans aucune réponse du serveur.
const MUTABLE_LLM: LlmSettings = { ...LLM_LOCAL, endpoint_url: "http://192.168.1.15:8080/v1", model_name: "gemma-4-E2B-it-qat" };

// Les conversations de l'aperçu : un vrai petit magasin, pas deux tableaux
// figés — « nouvelle conversation », l'ouverture d'un ancien fil et la
// suppression doivent se comporter comme sur le serveur, sinon l'aperçu ne
// dit rien de l'écran qu'on est en train de juger.
interface MockChat {
  id: number;
  conversation_id: number;
  text: string;
  created_at: string;
  answer: Record<string, unknown>;
}

let MOCK_CHATS: MockChat[] = [];
let NEXT_CHAT_ID = 1;

function mockConversations() {
  const threads = new Map<number, MockChat[]>();
  for (const row of MOCK_CHATS) {
    const bucket = threads.get(row.conversation_id) ?? [];
    bucket.push(row);
    threads.set(row.conversation_id, bucket);
  }
  return [...threads.entries()]
    .map(([id, rows]) => ({
      id,
      title: rows[0].text,
      started_at: rows[0].created_at,
      last_at: rows[rows.length - 1].created_at,
      message_count: rows.length,
    }))
    .sort((a, b) => b.last_at.localeCompare(a.last_at));
}

const WRITES: Record<string, (body: Record<string, unknown>) => Response> = {
  "POST /api/chat": (body) => {
    const asked = String(body.text ?? "");
    // Two canned answers, chosen so the drawer's chips have something real to
    // point at: one names a budget category, the other a card on another
    // screen.
    const about = /budget|courses/i.test(asked)
      ? {
          text: "Ton budget Courses a explosé ce mois-ci : 244,43 € pour une enveloppe de 450,00 €. Tes abonnements pèsent aussi sur ton solde net.",
          amount_cents: -24443,
          query: "Somme des dépenses de la catégorie Courses sur le mois en cours.",
          // The shape `engines/answer.trace_query` returns for
          // `total_by_category`, with this fixture's own counts.
          steps: [
            {
              tool: "engines/intent",
              label: "Lecture de la question",
              source: "intention reconnue : total_by_category",
              screen: null,
            },
            {
              tool: "relevé",
              label: "Lecture du relevé",
              source: "142 opérations, 9 catégories, du 2025-10-01 au 2026-09-03",
              screen: "/transactions",
            },
            {
              tool: "engines/period",
              label: "Résolution de la période",
              source: "le mois en cours (septembre 2026)",
              screen: null,
            },
            {
              tool: "engines/aggregate",
              label: "Somme par catégorie",
              source: "catégorie « Courses »",
              screen: "/budgets",
            },
          ],
        }
      : {
          text: "Ton autonomie est de 2,2 mois au rythme actuel. Le flux de trésorerie du mois reste négatif.",
          amount_cents: null,
          query: "Solde disponible divisé par le rythme de dépenses médian des 11 derniers mois.",
          steps: [
            {
              tool: "engines/intent",
              label: "Lecture de la question",
              source: "intention reconnue : feasibility",
              screen: null,
            },
            {
              tool: "engines/capacity",
              label: "Mesure des rythmes mensuels",
              source: "11 mois observés",
              screen: "/tresorerie",
            },
            {
              tool: "solde",
              label: "Relevé du solde disponible",
              source: "4 182,60 € disponibles",
              screen: "/tresorerie",
            },
            {
              tool: "engines/feasibility",
              label: "Évaluation de la faisabilité",
              source: "mensualités de dettes déjà engagées 425,00 €",
              screen: "/faisabilite",
            },
          ],
        };
    const conversationId =
      typeof body.conversation_id === "number"
        ? body.conversation_id
        : Math.max(0, ...MOCK_CHATS.map((row) => row.conversation_id)) + 1;
    const stored: MockChat = {
      id: NEXT_CHAT_ID++,
      conversation_id: conversationId,
      text: asked,
      created_at: new Date().toISOString(),
      answer: {
        recognised: true,
        query_description: about.query,
        text: about.text,
        amount_cents: about.amount_cents,
        is_refusal: false,
        supported_formulations: null,
        chart: null,
        steps: about.steps,
      },
    };
    MOCK_CHATS.push(stored);
    return jsonOk(stored);
  },
  "PUT /api/assistant/llm-settings": (body) => {
    const seconds = body.timeout_seconds;
    if (typeof seconds === "number" && (seconds < 5 || seconds > 600)) {
      return new Response(
        JSON.stringify({ detail: "Le délai doit être compris entre 5 et 600 secondes." }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }
    if (typeof body.endpoint_url === "string") MUTABLE_LLM.endpoint_url = body.endpoint_url;
    if (typeof body.model_name === "string") MUTABLE_LLM.model_name = body.model_name;
    // null veut dire « laissé tel quel », jamais « remis au défaut ».
    if (typeof seconds === "number") MUTABLE_LLM.timeout_seconds = seconds;
    MUTABLE_LLM.configured = true;
    return jsonOk(MUTABLE_LLM);
  },
  "POST /api/access-key/rotate": () => {
    agentKey = mintAgentKey();
    return jsonOk(agentKey);
  },
  "DELETE /api/access-key": () => {
    agentKey = null;
    return new Response(null, { status: 204 });
  },
  "PATCH /api/auth/me": (body) => {
    if (typeof body.email === "string" && body.email.includes("lea@")) {
      return new Response(JSON.stringify({ detail: "Un compte avec cet email existe déjà" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (typeof body.name === "string") MUTABLE_USER.name = body.name;
    if (typeof body.email === "string") MUTABLE_USER.email = body.email.toLowerCase();
    return new Response(JSON.stringify(MUTABLE_USER), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
  "POST /api/auth/password": (body) => {
    if (body.current_password !== "apercu") {
      return new Response(JSON.stringify({ detail: "Le mot de passe actuel est incorrect" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 204 });
  },
};

export function installMockApi(): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (!url.pathname.startsWith("/api/")) return real(input as RequestInfo, init);

    const method = (init?.method ?? "GET").toUpperCase();

    // Les deux seules routes de l'application dont le comportement dépend d'un
    // paramètre de requête. Le répartiteur ci-dessous n'indexe que le chemin,
    // et un aperçu qui rendrait tous les messages quel que soit le fil ne
    // dirait rien de l'écran qu'on juge.
    if (url.pathname === "/api/chat") {
      const scope = url.searchParams.get("conversation_id");
      if (method === "GET" && scope !== null) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return jsonOk(MOCK_CHATS.filter((row) => String(row.conversation_id) === scope));
      }
      if (method === "DELETE") {
        MOCK_CHATS =
          scope === null ? [] : MOCK_CHATS.filter((row) => String(row.conversation_id) !== scope);
        return new Response(null, { status: 204 });
      }
    }

    const write = WRITES[`${method} ${url.pathname}`];
    if (write) {
      // Une question à l'assistant parcourt tout le relevé côté serveur ; le
      // délai plus long ici sert à voir l'état d'attente, que les 220 ms des
      // autres écritures ne laissent pas apercevoir.
      const wait = url.pathname === "/api/chat" && method === "POST" ? 900 : 220;
      await new Promise((resolve) => setTimeout(resolve, wait));
      const raw = typeof init?.body === "string" ? init.body : "{}";
      return write(JSON.parse(raw) as Record<string, unknown>);
    }

    const handler = ROUTES[url.pathname];
    if (!handler) {
      return new Response(
        JSON.stringify({ detail: `Aperçu : ${url.pathname} n'est pas simulé dans ce mode.` }),
        { status: 501, headers: { "Content-Type": "application/json" } },
      );
    }
    // Un délai court, pour que les squelettes de chargement soient visibles.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return new Response(JSON.stringify(handler(url.searchParams)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}
