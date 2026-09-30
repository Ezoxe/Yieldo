/**
 * What a universe draws, read from the page's figures. Pure, so the rules the
 * spec states — which reference a level is measured against, which part is in
 * front — are tested here rather than in a picture.
 *
 * Only two things in a scene carry a figure: the gauge (the page's own
 * ceiling) and a part's level. Both are a SHARE STILL UNSPENT in [0, 1]:
 * clamped, because a tank cannot hold less than nothing — an overrun is said
 * in figures on the label, where it can be read exactly.
 */
import type { BudgetDetail, BudgetDetailPart, BudgetReading, BudgetStatus } from "../../../lib/types";
import { partFor, type PartId, type UniverseMatch } from "./registry";

export interface Gauge {
  remainingCents: number;
  budgetCents: number;
  share: number;
  status: BudgetStatus;
}

/** `budget`: the part's own ceiling. `average`: its monthly mean, said as such on screen. */
export type LevelBasis = "budget" | "average";

export interface Level {
  share: number;
  basis: LevelBasis;
  /** The ceiling or the mean the share is measured against, positive. */
  referenceCents: number;
}

export interface PartReading {
  categoryId: number;
  name: string;
  part: PartId;
  spentCents: number;
  count: number;
  level: Level | null;
  budget: BudgetReading | null;
  averageCents: number | null;
  /** The part's own budget state; null when it has no ceiling. */
  status: BudgetStatus | null;
  focused: boolean;
  dimmed: boolean;
}

function clampShare(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function gaugeFor(budget: BudgetReading | null): Gauge | null {
  if (budget === null || budget.budget_cents <= 0) return null;
  return {
    remainingCents: budget.remaining_cents,
    budgetCents: budget.budget_cents,
    share: clampShare(budget.remaining_cents / budget.budget_cents),
    status: budget.status,
  };
}

export function levelFor(
  part: Pick<BudgetDetailPart, "spent_cents" | "average_cents" | "budget">,
): Level | null {
  if (part.budget !== null && part.budget.budget_cents > 0) {
    return {
      share: clampShare(part.budget.remaining_cents / part.budget.budget_cents),
      basis: "budget",
      referenceCents: part.budget.budget_cents,
    };
  }
  // No mean under three complete months, and a mean of zero measures nothing:
  // no level at all rather than a full or an empty tank standing in for one.
  if (part.average_cents !== null && part.average_cents !== 0) {
    const reference = Math.abs(part.average_cents);
    return {
      share: clampShare(1 - Math.abs(part.spent_cents) / reference),
      basis: "average",
      referenceCents: reference,
    };
  }
  return null;
}

function pageAsPart(detail: BudgetDetail): BudgetDetailPart {
  return {
    category_id: detail.category.id,
    name: detail.category.name,
    slug: detail.category.slug,
    color: detail.category.color,
    spent_cents: detail.spent_cents,
    count: detail.count,
    average_ticket_cents: detail.average_ticket_cents,
    average_cents: detail.average_cents,
    months_counted: detail.months_counted,
    budget: detail.budget,
  };
}

/**
 * The parts a scene draws: a family's children on a family page, the
 * siblings around a child (the child in front, the rest dimmed), or the page
 * itself when a root category is recognised as one part. A child the universe
 * has no part for is left to the « Postes » panel. When two categories map to
 * one part (rent and mortgage are both the key in the door), one is drawn —
 * the page's own if it is one of the two, else the one the household actually
 * pays, by its mean or else this month — and the other stays in the panel.
 */
/** How much a part weighs, to pick between two categories sharing it. */
function weight(reading: PartReading): number {
  return Math.abs(reading.averageCents ?? reading.spentCents);
}

export function partReadings(detail: BudgetDetail, match: UniverseMatch): PartReading[] {
  const source =
    match.focus === null
      ? detail.parts
      : detail.category.parent === null
        ? [pageAsPart(detail)]
        : detail.siblings;

  const byPart = new Map<PartId, PartReading>();
  for (const entry of source) {
    const part = partFor(match.universe, entry);
    if (part === null) continue;
    const focused = entry.category_id === detail.category.id;
    const reading: PartReading = {
      categoryId: entry.category_id,
      name: entry.name,
      part,
      spentCents: entry.spent_cents,
      count: entry.count,
      level: levelFor(entry),
      budget: entry.budget,
      averageCents: entry.average_cents,
      status: entry.budget?.status ?? null,
      focused,
      dimmed: match.focus !== null && !focused,
    };
    const drawn = byPart.get(part);
    if (drawn === undefined || focused || (!drawn.focused && weight(reading) > weight(drawn))) {
      byPart.set(part, reading);
    }
  }
  return source
    .map((entry) => byPart.get(partFor(match.universe, entry) as PartId))
    .filter((reading, index, all): reading is PartReading =>
      reading !== undefined && all.indexOf(reading) === index,
    );
}
