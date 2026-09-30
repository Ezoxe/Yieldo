/**
 * A Transport family over nineteen months, for the tests and the `?apercu=1`
 * preview. Built from per-part month formulas so every total, count and mean
 * below is consistent with the series it comes from: the preview must never
 * show an average its own bars contradict.
 *
 * March 2025 to August 2026 are complete months; September 2026 is the month
 * in progress (statements stop on the 24th).
 */
import type { BudgetDetail, BudgetDetailMonth, BudgetDetailPart, BudgetDetailYear } from "../../../lib/types";

const KEYS: string[] = Array.from({ length: 19 }, (_, index) => {
  const month = new Date(Date.UTC(2025, 2 + index, 1));
  return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
});
const CURRENT = KEYS[KEYS.length - 1];

interface Flow {
  cents: number;
  count: number;
}

function monthOf(key: string): number {
  return Number(key.slice(5));
}

const PARTS: Array<{ id: number; name: string; slug: string; color: string; flow: (key: string, index: number) => Flow }> = [
  {
    id: 31, name: "Carburant", slug: "transport-carburant", color: "#f4a261",
    flow: (key, index) => (key === CURRENT ? { cents: -11800, count: 2 } : { cents: -(10400 + ((index * 37) % 9) * 280), count: 2 }),
  },
  {
    id: 32, name: "Entretien véhicule", slug: "transport-entretien", color: "#f4a261",
    flow: (key) => ([4, 10].includes(monthOf(key)) && key !== CURRENT ? { cents: -17800, count: 1 } : { cents: 0, count: 0 }),
  },
  {
    id: 33, name: "Assurance véhicule", slug: "transport-assurance", color: "#f4a261",
    flow: () => ({ cents: -5230, count: 1 }),
  },
  {
    id: 34, name: "Péage et stationnement", slug: "transport-peage", color: "#f4a261",
    flow: (key, index) => (key === CURRENT ? { cents: -3400, count: 2 } : { cents: -(1500 + ((index * 53) % 7) * 420), count: 2 }),
  },
  {
    id: 35, name: "Transports en commun", slug: "transport-commun", color: "#f4a261",
    flow: (key, index) => (index % 3 === 0 && key !== CURRENT ? { cents: -2500, count: 1 } : { cents: 0, count: 0 }),
  },
  {
    id: 36, name: "Billets et voyages", slug: "transport-voyage", color: "#f4a261",
    flow: (key) => ([7, 8].includes(monthOf(key)) ? { cents: -16500, count: 1 } : { cents: 0, count: 0 }),
  },
];

function mean(total: number, count: number): number {
  const magnitude = Math.floor((Math.abs(total) * 2 + count) / (2 * count));
  return total < 0 ? -magnitude : magnitude;
}

function seriesOf(flow: (key: string, index: number) => Flow): BudgetDetailMonth[] {
  return KEYS.map((key, index) => {
    const { cents, count } = flow(key, index);
    return { month: key, spent_cents: cents, count, complete: key !== CURRENT };
  });
}

function averageOf(series: BudgetDetailMonth[]): { average_cents: number | null; months_counted: number } {
  const complete = series.filter((month) => month.complete);
  if (complete.length < 3) return { average_cents: null, months_counted: complete.length };
  const total = complete.reduce((sum, month) => sum + month.spent_cents, 0);
  return { average_cents: mean(total, complete.length), months_counted: complete.length };
}

function yearsOf(series: BudgetDetailMonth[]): BudgetDetailYear[] {
  const years = new Map<number, BudgetDetailMonth[]>();
  for (const month of series.filter((entry) => entry.complete)) {
    const year = Number(month.month.slice(0, 4));
    years.set(year, [...(years.get(year) ?? []), month]);
  }
  return [...years.entries()].map(([year, months]) => {
    const total = months.reduce((sum, month) => sum + month.spent_cents, 0);
    return {
      year,
      spent_cents: total,
      months_counted: months.length,
      monthly_average_cents: months.length >= 3 ? mean(total, months.length) : null,
    };
  });
}

function partOut(part: (typeof PARTS)[number], budgetCents: number | null): BudgetDetailPart {
  const series = seriesOf(part.flow);
  const now = series[series.length - 1];
  return {
    category_id: part.id,
    name: part.name,
    slug: part.slug,
    color: part.color,
    spent_cents: now.spent_cents,
    count: now.count,
    average_ticket_cents: now.count > 0 ? mean(now.spent_cents, now.count) : null,
    ...averageOf(series),
    budget:
      budgetCents === null
        ? null
        : {
            budget_cents: budgetCents,
            spent_cents: now.spent_cents,
            remaining_cents: budgetCents + now.spent_cents,
            consumed_ratio: -now.spent_cents / budgetCents,
            projected_cents: null,
            status: -now.spent_cents >= budgetCents ? "over" : "ok",
          },
  };
}

const FUEL_BUDGET = 15000;
const TRANSPORT_BUDGET = 35000;

const familySeries: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});

const parts = PARTS.map((part) => partOut(part, part.slug === "transport-carburant" ? FUEL_BUDGET : null));
const familyNow = familySeries[familySeries.length - 1];
// The Budgets screen counts against the Transport ceiling what no child
// budget already covers: everything but Carburant, which has its own.
const transportCounted = familyNow.spent_cents - parts[0].spent_cents;

export const transportDetail: BudgetDetail = {
  category: { id: 30, name: "Transport", slug: "transport", color: "#f4a261", is_essential: false, parent: null },
  month: CURRENT,
  month_start: `${CURRENT}-01`,
  month_end: `${CURRENT}-30`,
  days_elapsed: 30,
  days_in_month: 30,
  is_current_month: false,
  spent_cents: familyNow.spent_cents,
  count: familyNow.count,
  average_ticket_cents: familyNow.count > 0 ? mean(familyNow.spent_cents, familyNow.count) : null,
  budget: {
    budget_cents: TRANSPORT_BUDGET,
    spent_cents: transportCounted,
    remaining_cents: TRANSPORT_BUDGET + transportCounted,
    consumed_ratio: -transportCounted / TRANSPORT_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(familySeries),
  years: yearsOf(familySeries),
  series: familySeries,
  parts,
  siblings: [],
  history: { date_from: "2025-03-01", date_to: "2026-09-24", transaction_count: 412 },
};

export const fuelDetail: BudgetDetail = {
  ...transportDetail,
  category: {
    id: 31, name: "Carburant", slug: "transport-carburant", color: "#f4a261", is_essential: true,
    parent: { id: 30, name: "Transport", slug: "transport" },
  },
  spent_cents: parts[0].spent_cents,
  count: parts[0].count,
  average_ticket_cents: parts[0].average_ticket_cents,
  budget: parts[0].budget,
  average_cents: parts[0].average_cents,
  months_counted: parts[0].months_counted,
  years: yearsOf(seriesOf(PARTS[0].flow)),
  series: seriesOf(PARTS[0].flow),
  parts: [],
  siblings: parts,
};

/** A category no universe covers: the page shows its figures without a scene. */
export const giftsDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 50, name: "Cadeaux", slug: "achats-cadeaux", color: "#fb7185", is_essential: false, parent: { id: 5, name: "Achats", slug: "achats" } },
  budget: null,
  parts: [],
  siblings: [],
};
