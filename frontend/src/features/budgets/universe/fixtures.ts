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

/**
 * The page of one of Transport's children, built from the same flows: its
 * own series, mean and years, the family around it as siblings. null for an
 * id that is not one of the fixture's parts.
 */
export function transportChildDetail(categoryId: number): BudgetDetail | null {
  const index = PARTS.findIndex((part) => part.id === categoryId);
  if (index === -1) return null;
  const source = PARTS[index];
  const part = parts[index];
  const series = seriesOf(source.flow);
  return {
    ...transportDetail,
    category: {
      id: part.category_id, name: part.name, slug: part.slug, color: part.color,
      is_essential: part.slug === "transport-carburant",
      parent: { id: 30, name: "Transport", slug: "transport" },
    },
    spent_cents: part.spent_cents,
    count: part.count,
    average_ticket_cents: part.average_ticket_cents,
    budget: part.budget,
    average_cents: part.average_cents,
    months_counted: part.months_counted,
    years: yearsOf(series),
    series,
    parts: [],
    siblings: parts,
  };
}

export const fuelDetail: BudgetDetail = transportChildDetail(31) as BudgetDetail;

/** A category no universe covers: the page shows its figures without a scene. */
export const giftsDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 50, name: "Cadeaux", slug: "achats-cadeaux", color: "#fb7185", is_essential: false, parent: { id: 5, name: "Achats", slug: "achats" } },
  budget: null,
  parts: [],
  siblings: [],
};

/* -- Logement over the same nineteen months, for the house ---------------- */

const HOME_PARTS: typeof PARTS = [
  { id: 11, name: "Loyer", slug: "logement-loyer", color: "#8ab4f8", flow: () => ({ cents: -92000, count: 1 }) },
  { id: 12, name: "Crédit immobilier", slug: "logement-credit", color: "#8ab4f8", flow: () => ({ cents: 0, count: 0 }) },
  {
    id: 13, name: "Charges et copropriété", slug: "logement-charges", color: "#8ab4f8",
    flow: (key) => ([1, 4, 7, 10].includes(monthOf(key)) && key !== CURRENT ? { cents: -9500, count: 1 } : { cents: 0, count: 0 }),
  },
  {
    id: 14, name: "Énergie", slug: "logement-energie", color: "#8ab4f8",
    flow: (key) => {
      const month = monthOf(key);
      const cents = [11, 12, 1, 2, 3].includes(month) ? -11800 : [6, 7, 8].includes(month) ? -5200 : -7800;
      return { cents, count: 1 };
    },
  },
  { id: 15, name: "Internet et téléphone", slug: "logement-internet", color: "#8ab4f8", flow: () => ({ cents: -4598, count: 2 }) },
  {
    id: 16, name: "Assurance habitation", slug: "logement-assurance", color: "#8ab4f8",
    flow: (key) => (monthOf(key) === 3 ? { cents: -28000, count: 1 } : { cents: 0, count: 0 }),
  },
  {
    id: 17, name: "Travaux et entretien", slug: "logement-travaux", color: "#8ab4f8",
    flow: (_key, index) => (index % 5 === 2 ? { cents: -8600, count: 1 } : { cents: 0, count: 0 }),
  },
];

const HOME_BUDGET = 125000;
const ENERGY_BUDGET = 15000;
const homeParts = HOME_PARTS.map((part) => partOut(part, part.slug === "logement-energie" ? ENERGY_BUDGET : null));
const homeSeries: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = HOME_PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});
const homeNow = homeSeries[homeSeries.length - 1];
// Énergie has its own ceiling: the Logement line counts everything else.
const homeCounted = homeNow.spent_cents - homeParts[3].spent_cents;

export const logementDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 10, name: "Logement", slug: "logement", color: "#8ab4f8", is_essential: true, parent: null },
  spent_cents: homeNow.spent_cents,
  count: homeNow.count,
  average_ticket_cents: homeNow.count > 0 ? mean(homeNow.spent_cents, homeNow.count) : null,
  budget: {
    budget_cents: HOME_BUDGET,
    spent_cents: homeCounted,
    remaining_cents: HOME_BUDGET + homeCounted,
    consumed_ratio: -homeCounted / HOME_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(homeSeries),
  years: yearsOf(homeSeries),
  series: homeSeries,
  parts: homeParts,
  siblings: [],
};

/** The page of one of Logement's children, the house around it. */
export function logementChildDetail(categoryId: number): BudgetDetail | null {
  const index = HOME_PARTS.findIndex((part) => part.id === categoryId);
  if (index === -1) return null;
  const part = homeParts[index];
  const series = seriesOf(HOME_PARTS[index].flow);
  return {
    ...logementDetail,
    category: {
      id: part.category_id, name: part.name, slug: part.slug, color: part.color, is_essential: true,
      parent: { id: 10, name: "Logement", slug: "logement" },
    },
    spent_cents: part.spent_cents,
    count: part.count,
    average_ticket_cents: part.average_ticket_cents,
    budget: part.budget,
    average_cents: part.average_cents,
    months_counted: part.months_counted,
    years: yearsOf(series),
    series,
    parts: [],
    siblings: homeParts,
  };
}

/* -- Abonnements over the same nineteen months, for the living room -------- */

const SUB_PARTS: typeof PARTS = [
  {
    id: 41, name: "Streaming", slug: "abonnements-streaming", color: "#7ee2d6",
    flow: (key) => ({ cents: key >= "2026-01" ? -2711 : -2461, count: 2 }),
  },
  { id: 42, name: "Logiciels et services", slug: "abonnements-logiciels", color: "#7ee2d6", flow: () => ({ cents: -1199, count: 1 }) },
  {
    id: 43, name: "Presse", slug: "abonnements-presse", color: "#7ee2d6",
    flow: (key, index) => (index % 2 === 0 && key !== CURRENT ? { cents: -900, count: 1 } : { cents: 0, count: 0 }),
  },
  { id: 44, name: "Salle de sport", slug: "abonnements-salle", color: "#7ee2d6", flow: () => ({ cents: -2999, count: 1 }) },
];

const SUB_BUDGET = 9000;
const STREAMING_BUDGET = 3000;
const subParts = SUB_PARTS.map((part) => partOut(part, part.slug === "abonnements-streaming" ? STREAMING_BUDGET : null));
const subSeries: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = SUB_PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});
const subNow = subSeries[subSeries.length - 1];
const subCounted = subNow.spent_cents - subParts[0].spent_cents;

export const abonnementsDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 40, name: "Abonnements", slug: "abonnements", color: "#7ee2d6", is_essential: false, parent: null },
  spent_cents: subNow.spent_cents,
  count: subNow.count,
  average_ticket_cents: subNow.count > 0 ? mean(subNow.spent_cents, subNow.count) : null,
  budget: {
    budget_cents: SUB_BUDGET,
    spent_cents: subCounted,
    remaining_cents: SUB_BUDGET + subCounted,
    consumed_ratio: -subCounted / SUB_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(subSeries),
  years: yearsOf(subSeries),
  series: subSeries,
  parts: subParts,
  siblings: [],
};

/* -- Alimentation over the same nineteen months, for the kitchen ----------- */

const FOOD_PARTS: typeof PARTS = [
  {
    id: 21, name: "Courses", slug: "alimentation-courses", color: "#4fd6a8",
    flow: (key, index) => (key === CURRENT ? { cents: -31250, count: 7 } : { cents: -(38000 + ((index * 41) % 7) * 1300), count: 9 }),
  },
  {
    id: 22, name: "Restaurants", slug: "alimentation-restaurant", color: "#4fd6a8",
    flow: (_key, index) => ({ cents: -(6800 + ((index * 29) % 5) * 1100), count: 3 }),
  },
  {
    id: 23, name: "Livraison", slug: "alimentation-livraison", color: "#4fd6a8",
    flow: (_key, index) => (index % 2 === 0 ? { cents: -3240, count: 2 } : { cents: -1620, count: 1 }),
  },
  { id: 24, name: "Cafés et bars", slug: "alimentation-cafe", color: "#4fd6a8", flow: () => ({ cents: -1860, count: 6 }) },
];

const FOOD_BUDGET = 60000;
const GROCERIES_BUDGET = 45000;
const foodParts = FOOD_PARTS.map((part) => partOut(part, part.slug === "alimentation-courses" ? GROCERIES_BUDGET : null));
const foodSeries: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = FOOD_PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});
const foodNow = foodSeries[foodSeries.length - 1];
const foodCounted = foodNow.spent_cents - foodParts[0].spent_cents;

export const alimentationDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 20, name: "Alimentation", slug: "alimentation", color: "#4fd6a8", is_essential: true, parent: null },
  spent_cents: foodNow.spent_cents,
  count: foodNow.count,
  average_ticket_cents: foodNow.count > 0 ? mean(foodNow.spent_cents, foodNow.count) : null,
  budget: {
    budget_cents: FOOD_BUDGET,
    spent_cents: foodCounted,
    remaining_cents: FOOD_BUDGET + foodCounted,
    consumed_ratio: -foodCounted / FOOD_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(foodSeries),
  years: yearsOf(foodSeries),
  series: foodSeries,
  parts: foodParts,
  siblings: [],
};

/* -- Santé over the same nineteen months, for the doctor's office --------- */

const HEALTH_PARTS: typeof PARTS = [
  {
    id: 61, name: "Consultations", slug: "sante-medecin", color: "#e5606b",
    // Up to two visits a month at 30 €, none some months.
    flow: (key, index) => {
      if (key === CURRENT) return { cents: -5000, count: 2 };
      const visits = (index * 5) % 3;
      return visits === 0 ? { cents: 0, count: 0 } : { cents: -3000 * visits, count: visits };
    },
  },
  {
    id: 62, name: "Pharmacie", slug: "sante-pharmacie", color: "#e5606b",
    flow: (key, index) => (key === CURRENT ? { cents: -2380, count: 3 } : { cents: -(1600 + ((index * 37) % 5) * 450), count: 2 }),
  },
  {
    id: 63, name: "Mutuelle", slug: "sante-mutuelle", color: "#e5606b",
    // The premium goes up every January.
    flow: (key) => ({ cents: key >= "2026-01" ? -6790 : -6490, count: 1 }),
  },
  {
    id: 64, name: "Optique et dentaire", slug: "sante-optique", color: "#e5606b",
    flow: (key) => {
      if (key === "2025-11") return { cents: -18900, count: 1 };
      if (key === "2026-03") return { cents: -6000, count: 1 };
      if (key === "2026-06") return { cents: -4500, count: 1 };
      return { cents: 0, count: 0 };
    },
  },
];

const HEALTH_BUDGET = 18000;
const PHARMACY_BUDGET = 4000;
const healthParts = HEALTH_PARTS.map((part) => partOut(part, part.slug === "sante-pharmacie" ? PHARMACY_BUDGET : null));
const healthSeries: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = HEALTH_PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});
const healthNow = healthSeries[healthSeries.length - 1];
// Pharmacie has a ceiling of its own: the Santé ceiling counts the rest.
const healthCounted = healthNow.spent_cents - healthParts[1].spent_cents;

export const santeDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 60, name: "Santé", slug: "sante", color: "#e5606b", is_essential: false, parent: null },
  spent_cents: healthNow.spent_cents,
  count: healthNow.count,
  average_ticket_cents: healthNow.count > 0 ? mean(healthNow.spent_cents, healthNow.count) : null,
  budget: {
    budget_cents: HEALTH_BUDGET,
    spent_cents: healthCounted,
    remaining_cents: HEALTH_BUDGET + healthCounted,
    consumed_ratio: -healthCounted / HEALTH_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(healthSeries),
  years: yearsOf(healthSeries),
  series: healthSeries,
  parts: healthParts,
  siblings: [],
};

/* -- Loisirs over the same nineteen months, for the entrance hall --------- */

const LEISURE_PARTS: typeof PARTS = [
  {
    id: 71, name: "Sorties et culture", slug: "loisirs-sorties", color: "#a78bfa",
    flow: (key, index) => (key === CURRENT ? { cents: -3850, count: 3 } : { cents: -(3200 + ((index * 31) % 6) * 700), count: 3 }),
  },
  {
    id: 72, name: "Sport", slug: "loisirs-sport", color: "#a78bfa",
    flow: (key, index) => (key === CURRENT ? { cents: -2400, count: 2 } : { cents: -(2000 + ((index * 17) % 4) * 600), count: 2 }),
  },
  {
    id: 73, name: "Vacances", slug: "loisirs-vacances", color: "#a78bfa",
    // Summer only: a rental in July, a campsite in August.
    flow: (key) => {
      if (monthOf(key) === 7) return { cents: -65000, count: 1 };
      if (monthOf(key) === 8) return { cents: -42000, count: 2 };
      return { cents: 0, count: 0 };
    },
  },
  {
    id: 74, name: "Loisirs et hobbies", slug: "loisirs-hobbies", color: "#a78bfa",
    flow: (key, index) => (key === CURRENT ? { cents: -1590, count: 1 } : { cents: -(1200 + ((index * 23) % 5) * 400), count: 1 }),
  },
];

const LEISURE_BUDGET = 25000;
const OUTINGS_BUDGET = 6000;
const leisureParts = LEISURE_PARTS.map((part) => partOut(part, part.slug === "loisirs-sorties" ? OUTINGS_BUDGET : null));
const leisureSeries: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = LEISURE_PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});
const leisureNow = leisureSeries[leisureSeries.length - 1];
// Sorties et culture has a ceiling of its own: the Loisirs ceiling counts the rest.
const leisureCounted = leisureNow.spent_cents - leisureParts[0].spent_cents;

export const loisirsDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 70, name: "Loisirs", slug: "loisirs", color: "#a78bfa", is_essential: false, parent: null },
  spent_cents: leisureNow.spent_cents,
  count: leisureNow.count,
  average_ticket_cents: leisureNow.count > 0 ? mean(leisureNow.spent_cents, leisureNow.count) : null,
  budget: {
    budget_cents: LEISURE_BUDGET,
    spent_cents: leisureCounted,
    remaining_cents: LEISURE_BUDGET + leisureCounted,
    consumed_ratio: -leisureCounted / LEISURE_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(leisureSeries),
  years: yearsOf(leisureSeries),
  series: leisureSeries,
  parts: leisureParts,
  siblings: [],
};

/* -- Achats over the same nineteen months, for the dressing room ---------- */

const SHOPPING_PARTS: typeof PARTS = [
  {
    id: 81, name: "Vêtements", slug: "achats-vetements", color: "#fb7185",
    flow: (key, index) => (key === CURRENT ? { cents: -8240, count: 2 } : { cents: -(6000 + ((index * 29) % 7) * 1500), count: 2 }),
  },
  {
    id: 82, name: "Équipement et high-tech", slug: "achats-equipement", color: "#fb7185",
    // Small things most months, a bigger one every fourth.
    flow: (key, index) => {
      if (key === CURRENT) return { cents: -12900, count: 1 };
      return index % 4 === 0 ? { cents: -(9900 + (index % 3) * 5000), count: 1 } : { cents: -(1500 + (index % 5) * 700), count: 1 };
    },
  },
  {
    id: 83, name: "Maison et décoration", slug: "achats-maison", color: "#fb7185",
    flow: (key, index) => (key === CURRENT ? { cents: -4690, count: 2 } : { cents: -(2500 + ((index * 13) % 6) * 900), count: 1 }),
  },
  {
    id: 84, name: "Cadeaux", slug: "achats-cadeaux", color: "#fb7185",
    // Christmas, and a birthday now and then.
    flow: (key, index) => {
      if (monthOf(key) === 12) return { cents: -25000, count: 4 };
      if (key !== CURRENT && index % 5 === 2) return { cents: -6000, count: 1 };
      return { cents: 0, count: 0 };
    },
  },
];

const SHOPPING_BUDGET = 30000;
const CLOTHES_BUDGET = 12000;
const shoppingParts = SHOPPING_PARTS.map((part) => partOut(part, part.slug === "achats-vetements" ? CLOTHES_BUDGET : null));
const shoppingSeries: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = SHOPPING_PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});
const shoppingNow = shoppingSeries[shoppingSeries.length - 1];
// Vêtements has a ceiling of its own: the Achats ceiling counts the rest.
const shoppingCounted = shoppingNow.spent_cents - shoppingParts[0].spent_cents;

export const achatsDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 80, name: "Achats", slug: "achats", color: "#fb7185", is_essential: false, parent: null },
  spent_cents: shoppingNow.spent_cents,
  count: shoppingNow.count,
  average_ticket_cents: shoppingNow.count > 0 ? mean(shoppingNow.spent_cents, shoppingNow.count) : null,
  budget: {
    budget_cents: SHOPPING_BUDGET,
    spent_cents: shoppingCounted,
    remaining_cents: SHOPPING_BUDGET + shoppingCounted,
    consumed_ratio: -shoppingCounted / SHOPPING_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(shoppingSeries),
  years: yearsOf(shoppingSeries),
  series: shoppingSeries,
  parts: shoppingParts,
  siblings: [],
};

/* -- Impôts over the same nineteen months, for the study ------------------ */

const TAX_PARTS: typeof PARTS = [
  {
    id: 91, name: "Impôt sur le revenu", slug: "impots-revenu", color: "#94a3b8",
    // The yearly balance, over 300 €, is taken in four instalments from September.
    flow: (key) => {
      if (key === CURRENT) return { cents: -24500, count: 1 };
      if (key >= "2025-09" && key <= "2025-12") return { cents: -7750, count: 1 };
      return { cents: 0, count: 0 };
    },
  },
  {
    id: 92, name: "Taxe foncière", slug: "impots-fonciere", color: "#94a3b8",
    flow: (key) => (key === "2025-10" ? { cents: -95000, count: 1 } : { cents: 0, count: 0 }),
  },
  { id: 93, name: "Taxe d'habitation", slug: "impots-habitation", color: "#94a3b8", flow: () => ({ cents: 0, count: 0 }) },
  {
    id: 94, name: "Autres prélèvements", slug: "impots-autres", color: "#94a3b8",
    flow: (key) => {
      if (key === CURRENT) return { cents: -1200, count: 1 };
      return key === "2026-04" ? { cents: -13500, count: 1 } : { cents: 0, count: 0 };
    },
  },
];

const TAX_BUDGET = 60000;
const INCOME_TAX_BUDGET = 45000;
const taxParts = TAX_PARTS.map((part) => partOut(part, part.slug === "impots-revenu" ? INCOME_TAX_BUDGET : null));
const taxSeries: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = TAX_PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});
const taxNow = taxSeries[taxSeries.length - 1];
// The income tax has a ceiling of its own: the Impôts ceiling counts the rest.
const taxCounted = taxNow.spent_cents - taxParts[0].spent_cents;

export const impotsDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 90, name: "Impôts et taxes", slug: "impots", color: "#94a3b8", is_essential: false, parent: null },
  spent_cents: taxNow.spent_cents,
  count: taxNow.count,
  average_ticket_cents: taxNow.count > 0 ? mean(taxNow.spent_cents, taxNow.count) : null,
  budget: {
    budget_cents: TAX_BUDGET,
    spent_cents: taxCounted,
    remaining_cents: TAX_BUDGET + taxCounted,
    consumed_ratio: -taxCounted / TAX_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(taxSeries),
  years: yearsOf(taxSeries),
  series: taxSeries,
  parts: taxParts,
  siblings: [],
};

/* -- Famille over the same nineteen months, for the nursery --------------- */

const FAMILY_PARTS: typeof PARTS = [
  {
    id: 101, name: "Garde d'enfants", slug: "famille-garde", color: "#f472b6",
    // The crèche, closed in August.
    flow: (key) => (monthOf(key) === 8 ? { cents: 0, count: 0 } : { cents: -42000, count: 1 }),
  },
  {
    id: 102, name: "Scolarité", slug: "famille-scolarite", color: "#f472b6",
    // The canteen in term time.
    flow: (key, index) => {
      if (key === CURRENT) return { cents: -3850, count: 2 };
      if ([7, 8].includes(monthOf(key))) return { cents: 0, count: 0 };
      return { cents: -(4800 + ((index * 11) % 4) * 300), count: 1 };
    },
  },
  {
    id: 103, name: "Animaux", slug: "famille-animaux", color: "#f472b6",
    flow: (key, index) => (key === CURRENT ? { cents: -2790, count: 1 } : { cents: -(2600 + ((index * 13) % 5) * 400), count: 1 }),
  },
];

const FAMILY_BUDGET = 15000;
const CHILDCARE_BUDGET = 60000;
const familyParts = FAMILY_PARTS.map((part) => partOut(part, part.slug === "famille-garde" ? CHILDCARE_BUDGET : null));
const familyMonths: BudgetDetailMonth[] = KEYS.map((key, index) => {
  const flows = FAMILY_PARTS.map((part) => part.flow(key, index));
  return {
    month: key,
    spent_cents: flows.reduce((sum, flow) => sum + flow.cents, 0),
    count: flows.reduce((sum, flow) => sum + flow.count, 0),
    complete: key !== CURRENT,
  };
});
const familyMonthNow = familyMonths[familyMonths.length - 1];
// The childcare has a ceiling of its own: the Famille ceiling counts the rest.
const familyCounted = familyMonthNow.spent_cents - familyParts[0].spent_cents;

export const familleDetail: BudgetDetail = {
  ...transportDetail,
  category: { id: 100, name: "Famille", slug: "famille", color: "#f472b6", is_essential: false, parent: null },
  spent_cents: familyMonthNow.spent_cents,
  count: familyMonthNow.count,
  average_ticket_cents: familyMonthNow.count > 0 ? mean(familyMonthNow.spent_cents, familyMonthNow.count) : null,
  budget: {
    budget_cents: FAMILY_BUDGET,
    spent_cents: familyCounted,
    remaining_cents: FAMILY_BUDGET + familyCounted,
    consumed_ratio: -familyCounted / FAMILY_BUDGET,
    projected_cents: null,
    status: "ok",
  },
  ...averageOf(familyMonths),
  years: yearsOf(familyMonths),
  series: familyMonths,
  parts: familyParts,
  siblings: [],
};
