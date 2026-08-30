import type { ReactNode } from "react";

import { formatCents, formatRateBps } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { Lever, LeverKind } from "../../lib/types";

/** `amortization.HCSF_DEBT_RATIO_BPS` — the Haut Conseil de stabilité financière
 *  ceiling on a French household's debt-service ratio, 35,00 %. A published
 *  regulatory threshold, named here only so the sentence can quote it; the
 *  comparison itself is made in the engine and arrives as
 *  `debt_ratio_exceeded`. */
const HCSF_DEBT_RATIO_BPS = 3_500;

const LEVER_TITLE: Record<LeverKind, string> = {
  save_more: "Épargner davantage",
  delay: "Repousser l'échéance",
  reduce_target: "Viser moins cher",
  borrow: "Emprunter la différence",
  cut_category: "Réduire un poste de dépense",
};

/** What each lever changes, so a card is readable before its figure is. */
const LEVER_SUBTITLE: Record<LeverKind, string> = {
  save_more: "Garder l'échéance et le prix, mettre plus de côté chaque mois.",
  delay: "Garder le prix et le rythme, se donner plus de temps.",
  reduce_target: "Garder l'échéance et le rythme, acheter moins cher.",
  borrow: "Financer ce qui manque, et le rembourser.",
  cut_category: "Libérer la somme sur un poste précis de votre budget.",
};

/** `effort_ratio` as a whole French percentage. Rounded, because a ratio is not
 *  money and two decimals on an effort claim a precision three months of
 *  statements do not support. */
function effortLabel(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

/**
 * Whether a cut of this size has ever actually happened.
 *
 * Design §6.3 item 5 asks for "l'historique qui dit si c'est réaliste", and a
 * proposal without it is a guess with a euro sign on it. Zero months gets its
 * own sentence rather than "0 des 4": the reader needs to know the cut has
 * never once been held, not to divide two numbers.
 */
function historyLabel(atOrBelow: number, observed: number): string {
  if (atOrBelow === 0) {
    return `Vos relevés ne montrent aucun mois à ce niveau : cette coupe n'a jamais été tenue sur les ${observed} ${plural(observed, "mois observé", "mois observés")}.`;
  }
  return `${atOrBelow} des ${observed} ${plural(observed, "mois observé", "mois observés")} y ${plural(atOrBelow, "était", "étaient")} déjà.`;
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="yd-lever__figure">
      <span className="yd-lever__figure-label">{label}</span>
      <span className={`yd-lever__figure-value${tone ? ` yd-lever__figure-value--${tone}` : ""}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * The figures one lever carries. Keyed on `kind` and nothing else: every field
 * on `Lever` is populated on exactly one kind and null on the other four, so a
 * card that read a field outside its own switch arm would be reading a null.
 */
function leverBody(lever: Lever): ReactNode {
  switch (lever.kind) {
    case "save_more":
      return lever.extra_monthly_cents === null ? null : (
        <>
          <Figure
            label="À mettre de côté en plus, chaque mois"
            value={formatCents(lever.extra_monthly_cents, { signed: true })}
            tone="strong"
          />
          {/* Only when there IS a ratio. Against a capacity that is not
              positive the engine sends null rather than a number, because a
              ratio on a negative denominator is a sign error waiting to be
              rendered as "−540 % d'effort". */}
          {lever.effort_ratio !== null ? (
            <Figure
              label="Soit, par rapport à votre capacité mesurée"
              value={`${effortLabel(lever.effort_ratio)} d'effort en plus`}
            />
          ) : null}
        </>
      );

    case "delay":
      return lever.delay_months === null ? null : (
        <>
          <Figure
            label="À attendre en plus"
            value={`${lever.delay_months} ${plural(lever.delay_months, "mois", "mois")}`}
            tone="strong"
          />
          {lever.reached_in_months !== null ? (
            <Figure
              label="La somme serait réunie dans"
              value={`${lever.reached_in_months} mois`}
            />
          ) : null}
        </>
      );

    case "reduce_target":
      return lever.reduced_target_cents === null ? null : (
        <Figure
          label="Ce que l'échéance permet réellement"
          value={formatCents(lever.reduced_target_cents)}
          tone="strong"
        />
      );

    case "borrow":
      return lever.borrow_cents === null ? null : (
        <>
          <Figure label="À emprunter" value={formatCents(lever.borrow_cents)} tone="strong" />
          {lever.loan_payment_cents !== null ? (
            <Figure label="Mensualité" value={formatCents(lever.loan_payment_cents)} />
          ) : null}
          {lever.loan_total_interest_cents !== null ? (
            <Figure
              label="Intérêts sur toute la durée"
              value={formatCents(lever.loan_total_interest_cents)}
            />
          ) : null}
          {/* The null FIRST. `debt_ratio_exceeded` is false both when the ratio
              is comfortably under the threshold AND when there is no ratio at
              all, and the flag alone cannot tell the two apart. */}
          {lever.debt_ratio_bps === null ? null : (
            <div
              className={`yd-lever__ratio${
                lever.debt_ratio_exceeded ? " yd-lever__ratio--exceeded" : ""
              }`}
              data-testid="yd-lever-ratio"
            >
              <span className="yd-lever__figure-label">Taux d'endettement</span>
              <span className="yd-lever__figure-value">
                {formatRateBps(lever.debt_ratio_bps)}
              </span>
              <span className="yd-lever__ratio-note">
                {lever.debt_ratio_exceeded
                  ? `Au-delà du seuil de ${formatRateBps(HCSF_DEBT_RATIO_BPS)} retenu par le Haut Conseil de stabilité financière : à ce niveau, aucune banque française ne prête.`
                  : `Sous le seuil de ${formatRateBps(HCSF_DEBT_RATIO_BPS)} retenu par le Haut Conseil de stabilité financière.`}
              </span>
            </div>
          )}
        </>
      );

    case "cut_category":
      return (
        <>
          {lever.category_name !== null ? (
            <Figure label="Le poste le plus lourd" value={lever.category_name} tone="strong" />
          ) : null}
          {lever.category_median_cents !== null ? (
            <Figure
              label="Ce qu'il coûte un mois normal"
              value={formatCents(lever.category_median_cents)}
            />
          ) : null}
          {lever.cut_monthly_cents !== null ? (
            <Figure
              label="À y retrancher chaque mois"
              value={formatCents(lever.cut_monthly_cents)}
            />
          ) : null}
          {/* `months_at_or_below` is null on every branch proposing no cut,
              INCLUDING the refusal that still names a category — there is no
              post-cut level to count against, and "0 des 1 mois observés" would
              be a measurement nobody made. */}
          {lever.months_at_or_below !== null && lever.months_observed !== null ? (
            <p className="yd-lever__history">
              {historyLabel(lever.months_at_or_below, lever.months_observed)}
            </p>
          ) : null}
        </>
      );
  }
}

interface LeverListProps {
  levers: Lever[];
}

/**
 * The five levers, feasible first.
 *
 * They are NOT ranked by a score, and that is a decision rather than an
 * omission: euros per month, months of delay, euros of target and a debt ratio
 * do not share a scale, and collapsing them onto one means dividing by a
 * quantity the data controls. The order is the engine's — feasible first, then
 * the documented tie-break — and the screen never re-sorts it.
 *
 * Renders NOTHING on an empty list. `build_levers` returns `[]` when the
 * capacity could not be measured, and five cards each repeating one refusal
 * would be five copies of a sentence `VerdictPanel` already prints once.
 */
export function LeverList({ levers }: LeverListProps) {
  if (levers.length === 0) return null;

  return (
    <div className="yd-levers">
      <p className="yd-levers__lead">
        Les leviers réalisables d'abord, puis les autres. Ils ne sont pas classés par un score :
        des euros par mois, des mois d'attente, un prix et un taux d'endettement ne se comparent
        pas entre eux, et un classement unique reviendrait à inventer la comparaison.
      </p>

      <div className="yd-levers__grid">
        {levers.map((lever) => (
          <article
            key={lever.kind}
            className={`yd-lever${lever.feasible ? "" : " yd-lever--unavailable"}`}
            data-testid={`yd-lever-${lever.kind}`}
          >
            <div className="yd-lever__head">
              <h3 className="yd-lever__title">{LEVER_TITLE[lever.kind]}</h3>
              {lever.feasible ? null : (
                <span className="yd-lever__badge">Impossible ici</span>
              )}
            </div>
            <p className="yd-lever__subtitle">{LEVER_SUBTITLE[lever.kind]}</p>

            {lever.feasible ? leverBody(lever) : null}

            {/* Verbatim, and its own: ten distinct wordings live in
                `engines/levers.py`, one per branch, and blurring two of them
                into a shared sentence is this project's most repeated defect. */}
            {lever.unavailable_reason !== null ? (
              <p className="yd-lever__reason" data-testid={`yd-lever-reason-${lever.kind}`}>
                {lever.unavailable_reason}
              </p>
            ) : null}

            {/* A remark on a FEASIBLE lever, never a substitute for a refusal. */}
            {lever.note !== null ? <p className="yd-lever__note">{lever.note}</p> : null}

            {/* A refused lever can still carry figures worth showing — the
                category it named, the amount it could not price. */}
            {lever.feasible ? null : leverBody({ ...lever, feasible: true })}
          </article>
        ))}
      </div>
    </div>
  );
}
