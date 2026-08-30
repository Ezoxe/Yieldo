import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { Feasibility, Verdict } from "../../lib/types";

/**
 * `capacity.MIN_MONTHS_FOR_RATE`, named here only so one French sentence can
 * state the floor. Nothing is computed from it: the refusal itself travels on
 * the wire as `capacity_unavailable_reason`. Same arrangement as
 * `CashflowPage`'s own copy of this constant.
 */
const MIN_MONTHS_FOR_RATE = 3;

const VERDICT_LABEL: Record<Verdict, string> = {
  comfortable: "Atteignable confortablement",
  tight: "Atteignable en serrant",
  out_of_reach: "Hors de portée",
};

/**
 * Why the verdict is what it is, in one sentence, on the branch that earned it.
 *
 * Five registers, mutually exclusive by construction. Two of them deserve their
 * own note:
 *
 * **The deficit register.** A household whose measured capacity is a DEFICIT is
 * not merely short of the target — its savings are going backwards, and a
 * sentence that only says "il vous manque X" sends the reader looking for a
 * bigger apport when the actual remedy is somewhere else entirely. This is the
 * operator's own state (−746,19 € a month), so it is the branch most likely to
 * be read. The follow-on clause — that the gap exceeds the price itself — is
 * appended only when `gap_cents > target_cents` is really true: a large apport
 * can hold the projection above zero on the very same deficit, and printing the
 * clause there would be a true number under a false sentence, which is exactly
 * the defect phase 2A fixed five times.
 *
 * **The two shapes of `out_of_reach`.** `saved_at_horizon_high_cents` is
 * published by `engines/feasibility.py` precisely so a screen can tell "dans un
 * bon mois c'est jouable" from "même un bon mois n'y suffit pas" without a
 * fourth verdict value. Both are said here, each on its own comparison against
 * the target; the operator's high end is 24 144,42 € against 40 000 €, so he
 * gets the second.
 */
function verdictExplanation(report: Feasibility, verdict: Verdict): string {
  const capacity = report.capacity;
  if (capacity === null) return "";
  const horizon = `${report.horizon_months} mois`;
  const median = report.saved_at_horizon_cents ?? 0;
  const low = report.saved_at_horizon_low_cents ?? 0;
  const high = report.saved_at_horizon_high_cents ?? 0;

  if (capacity.median_cents <= 0) {
    const deficit =
      `Au rythme mesuré dans vos relevés, votre épargne diminue de ` +
      `${formatCents(Math.abs(capacity.median_cents))} par mois. En ${horizon} elle ` +
      `n'augmente donc pas : elle recule.`;
    // The clause is a claim about THIS report's arithmetic, so it is checked
    // against it rather than assumed from the sign of the capacity.
    return (report.gap_cents ?? 0) > report.target_cents
      ? `${deficit} L'écart avec le prix dépasse de ce fait le prix lui-même — ce n'est pas ` +
          `une erreur de calcul, c'est que la somme mise de côté rétrécit.`
      : `${deficit} Votre apport tient la projection au-dessus de zéro, mais il s'érode au ` +
          `lieu de grossir.`;
  }

  if (verdict === "comfortable") {
    return (
      `Même en enchaînant des mois faibles — ${formatCents(capacity.low_cents)} par mois, le ` +
      `bas de la variabilité mesurée — vous atteignez ${formatCents(low)} en ${horizon}.`
    );
  }
  if (verdict === "tight") {
    return (
      `Vous y arrivez au rythme médian mesuré, mais pas en enchaînant des mois faibles : au ` +
      `bas de votre variabilité vous n'atteignez que ${formatCents(low)}.`
    );
  }
  if (high >= report.target_cents) {
    return (
      `Au rythme médian mesuré vous atteignez ${formatCents(median)} en ${horizon}, en dessous ` +
      `du prix. Dans un bon mois — le haut de votre variabilité — vous atteindriez ` +
      `${formatCents(high)}, ce qui suffirait : c'est jouable, mais cela suppose d'enchaîner ` +
      `${horizon} au-dessus de votre médiane.`
    );
  }
  return (
    `Au rythme médian mesuré vous atteignez ${formatCents(median)} en ${horizon}, et même au ` +
    `haut de votre variabilité ${formatCents(high)} — l'un et l'autre en dessous du prix.`
  );
}

/**
 * The gap, in the mood its sign has earned.
 *
 * `gap_cents` is the target minus what is projected: positive means short,
 * negative means a surplus. Printing the negative case through the "il manque"
 * template gives "il manque −866,55 €", which is the same class of defect as
 * phase 2A's refusal blaming a month count for a degenerate scale — a true
 * number under a false sentence.
 */
export function gapSentence(gapCents: number): string {
  if (gapCents > 0) return `Il manque ${formatCents(gapCents)} à l'échéance.`;
  if (gapCents === 0) return "La somme projetée tombe exactement sur le prix.";
  return `Il reste ${formatCents(Math.abs(gapCents))} de marge à l'échéance.`;
}

interface VerdictPanelProps {
  report: Feasibility;
}

/** One band end, beside the target it is being compared with. */
function BandRow({ label, cents, tone }: { label: string; cents: number; tone?: string }) {
  return (
    <div className="yd-verdict__row">
      <span className="yd-verdict__row-label">{label}</span>
      <span className={`yd-verdict__row-value${tone ? ` yd-verdict__row-value--${tone}` : ""}`}>
        {formatCents(cents, { signed: true })}
      </span>
    </div>
  );
}

export function VerdictPanel({ report }: VerdictPanelProps) {
  // Branch on the refusal FIRST, then on the sign. Two states with two different
  // remedies: import more statements, or change what a month costs. Deriving one
  // boolean from both is how this project has repeatedly ended up telling a user
  // the wrong one.
  if (report.capacity === null) {
    return (
      <div className="yd-verdict yd-verdict--unmeasured" data-testid="yd-verdict">
        <div className="yd-verdict__head">
          <h2 className="yd-panel__title">Verdict</h2>
        </div>
        {/* The engine's own sentence, verbatim: it names WHICH cause applies. */}
        <p className="yd-verdict__refusal">{report.capacity_unavailable_reason}</p>
        <p className="yd-verdict__note">
          {`Vos relevés couvrent ${report.months_observed} ${plural(
            report.months_observed,
            "mois complet",
            "mois complets",
          )}. Il en faut au moins ${MIN_MONTHS_FOR_RATE} pour qu'une médiane veuille dire quelque chose.`}
        </p>
      </div>
    );
  }

  const capacity = report.capacity;
  const verdict = report.verdict;

  // The wire contract is "all five null exactly when `capacity_unavailable_reason`
  // is set". A capacity with no verdict beside it breaks it, and picking one
  // here would print a verdict nobody computed — the fallback the contract
  // forbids. It is stated instead.
  if (verdict === null) {
    return (
      <div className="yd-verdict yd-verdict--unmeasured" data-testid="yd-verdict">
        <div className="yd-verdict__head">
          <h2 className="yd-panel__title">Verdict</h2>
        </div>
        <p className="yd-verdict__refusal">
          Votre capacité d'épargne a bien été mesurée, mais le serveur n'a pas renvoyé de verdict
          pour cet achat. Aucun n'est affiché ici : en inventer un serait pire que de le dire.
        </p>
      </div>
    );
  }

  return (
    <div className={`yd-verdict yd-verdict--${verdict}`} data-testid="yd-verdict">
      <div className="yd-verdict__head">
        <h2 className="yd-panel__title">Verdict</h2>
        <p className="yd-verdict__label">{VERDICT_LABEL[verdict]}</p>
      </div>

      <div className="yd-verdict__figure">
        <p className="yd-verdict__figure-label">Épargne projetée à l'échéance</p>
        <p
          className={`yd-verdict__amount${
            (report.saved_at_horizon_cents ?? 0) < 0 ? " yd-verdict__amount--negative" : ""
          }`}
        >
          {formatCents(report.saved_at_horizon_cents ?? 0, { signed: true })}
        </p>
        <p className="yd-verdict__gap">{gapSentence(report.gap_cents ?? 0)}</p>
      </div>

      <p className="yd-verdict__explanation">{verdictExplanation(report, verdict)}</p>

      {/* The two band ends, against the price. The median is the figure above —
          repeating it here would print one measurement twice and let the two
          drift apart the day one of them is reformatted. */}
      <div className="yd-verdict__band">
        <BandRow
          label="En enchaînant des mois faibles"
          cents={report.saved_at_horizon_low_cents ?? 0}
        />
        <BandRow label="En enchaînant de bons mois" cents={report.saved_at_horizon_high_cents ?? 0} />
        <div className="yd-verdict__row yd-verdict__row--target">
          <span className="yd-verdict__row-label">Prix visé</span>
          <span className="yd-verdict__row-value">{formatCents(report.target_cents)}</span>
        </div>
      </div>

      <p className="yd-verdict__capacity">
        {`Capacité d'épargne mesurée : `}
        <span className="yd-num">{formatCents(capacity.median_cents, { signed: true })}</span>
        {` par mois, entre ${formatCents(capacity.low_cents, {
          signed: true,
        })} et ${formatCents(capacity.high_cents, { signed: true })} d'un mois à l'autre.`}
      </p>
      <p className="yd-verdict__sample">
        {`Mesurée sur ${capacity.months} mois de relevés, pas déclarée. À l'échéance du ${frenchDate(
          report.horizon_end_on,
        )}.`}
      </p>
    </div>
  );
}
