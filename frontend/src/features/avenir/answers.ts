import { formatCents } from "../../design/theme";
import type { Outlook, OutlookReliability } from "../../lib/types";

/**
 * The three answers Avenir leads with, worked out from the wire. Pure, so the
 * sentences are tested without rendering anything.
 */

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** "2026-10" → "octobre 2026". */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** "2026-09-27" → "27 septembre". */
export function dayLabel(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day === 1 ? "1er" : day} ${MONTHS[month - 1]}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) /
    86_400_000);
}

// Under a week left in the month, its end is nearly the present: the answer
// worth giving is the next one.
const ENOUGH_OF_THE_MONTH_LEFT_DAYS = 7;

export interface MonthEndAnswer {
  title: string;
  p10: number;
  p50: number;
  p90: number;
}

export function endOfMonthAnswer(outlook: Outlook): MonthEndAnswer | null {
  const chosen = outlook.months.find((month) => {
    const [year, number] = month.key.split("-").map(Number);
    const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
    return daysBetween(outlook.as_of, last) > ENOUGH_OF_THE_MONTH_LEFT_DAYS;
  });
  if (chosen === undefined) return null;
  const name = MONTHS[Number(chosen.key.split("-")[1]) - 1];
  return { title: `Fin ${name} prévue`, p10: chosen.p10_cents, p50: chosen.p50_cents,
           p90: chosen.p90_cents };
}

/** "veille de <revenu>" when money comes in the day after the low point. */
export function lowPointContext(outlook: Outlook): string | null {
  if (outlook.low_point === null) return null;
  const next = new Date(Date.parse(`${outlook.low_point.on}T00:00:00Z`) + 86_400_000)
    .toISOString().slice(0, 10);
  const income = outlook.events.find((event) => event.on === next && event.amount_cents > 0);
  return income ? `veille de ${income.label}` : null;
}

export type Tone = "positive" | "warning" | "negative";

export function riskPill(outlook: Outlook): { text: string; tone: Tone } {
  const floor = outlook.threshold_source === "alert";
  if (outlook.risk === "probable") {
    return { text: floor ? "Seuil franchi" : "Découvert probable", tone: "negative" };
  }
  if (outlook.risk === "possible") {
    return { text: floor ? "Seuil menacé" : "Découvert possible", tone: "warning" };
  }
  return { text: floor ? "Seuil respecté" : "Pas de découvert prévu", tone: "positive" };
}

export type ReliabilityAnswer =
  | { kind: "measured"; headline: string; detail: string }
  | { kind: "refused"; reason: string };

export function reliabilityAnswer(reliability: OutlookReliability): ReliabilityAnswer {
  const month = reliability.horizons.find((score) => score.horizon_months === 1);
  if (month === undefined) {
    return { kind: "refused", reason: reliability.refusal ?? "Fiabilité indisponible." };
  }
  return {
    kind: "measured",
    headline: `±${formatCents(month.mean_abs_error_cents, { decimals: 0 })}`,
    detail: `à 1 mois · ${month.inside_band} fois sur ${month.replays} dans la fourchette`,
  };
}
