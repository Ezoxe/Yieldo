import { formatCents, formatRateBps } from "../../design/theme";
import type { Financing, FinancingKind, FinancingOption } from "../../lib/types";

const OPTION_TITLE: Record<FinancingKind, string> = {
  cash: "Comptant",
  credit: "Crédit",
  loa: "LOA",
};

/** What each column assumes, so the three end-wealth figures are comparable
 *  rather than merely adjacent. The framing is `engines/levers.py`'s: income is
 *  held constant, not capital. */
const OPTION_RULE: Record<FinancingKind, string> = {
  cash: "Le capital part le premier jour, et la mensualité que vous ne devez pas est placée chaque mois.",
  credit: "Seul l'apport part ; le reste du capital demeure placé, et la mensualité sort de vos revenus.",
  loa: "Des loyers, et une option d'achat que vous levez ou non à la fin.",
};

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="yd-fin__line">
      <span className="yd-fin__line-label">{label}</span>
      <span className="yd-fin__line-value">{value}</span>
    </div>
  );
}

function Column({ option, onAddLoa }: { option: FinancingOption; onAddLoa: () => void }) {
  return (
    <article
      className={`yd-fin__option${option.available ? "" : " yd-fin__option--unavailable"}`}
      data-testid={`yd-fin-${option.kind}`}
    >
      <h3 className="yd-fin__option-title">{OPTION_TITLE[option.kind]}</h3>
      <p className="yd-fin__option-rule">{OPTION_RULE[option.kind]}</p>

      {option.available ? (
        <>
          {option.out_of_pocket_cents !== null ? (
            <Line label="Sorti de votre poche le jour J" value={formatCents(option.out_of_pocket_cents)} />
          ) : null}
          {option.monthly_cents !== null ? (
            <Line label="Par mois" value={formatCents(option.monthly_cents)} />
          ) : null}
          {option.total_paid_cents !== null ? (
            <Line label="Payé en tout" value={formatCents(option.total_paid_cents)} />
          ) : null}
          {/* `interest_cents` is null on the LOA line, where the split between
              loyer and intérêt is the lessor's and not published. */}
          {option.interest_cents !== null ? (
            <Line label="Dont intérêts" value={formatCents(option.interest_cents)} />
          ) : null}

          {/* NEVER a zero where the wealth figure would be. An available option
              can still carry a null here, with its own reason beside it. */}
          {option.wealth_at_end_cents !== null ? (
            <Line label="Patrimoine à la fin" value={formatCents(option.wealth_at_end_cents)} />
          ) : (
            <p className="yd-fin__reason">{option.wealth_unavailable_reason}</p>
          )}
        </>
      ) : (
        <>
          <p className="yd-fin__reason">{option.unavailable_reason}</p>
          {option.kind === "loa" ? (
            <button type="button" className="yd-fin__action" onClick={onAddLoa}>
              Saisir un devis de LOA
            </button>
          ) : null}
        </>
      )}
    </article>
  );
}

/**
 * Which of the two comparable paths leaves the household better off.
 *
 * `wealth_gap_cents` is read FIRST and `better_kind` second. `better_kind`
 * reports an exact tie as "cash" and cannot tell it from a win, so printing
 * "payer comptant est préférable" off the flag alone would name a preference
 * that does not exist — at the break-even rate itself, it never does.
 */
function betterSentence(financing: Financing): string {
  if (financing.wealth_gap_cents === null || financing.better_kind === null) {
    return (
      "Aucun des deux chemins ne peut être déclaré préférable : le crédit n'a pas pu être " +
      "chiffré, et comparer un patrimoine à rien n'est pas une comparaison."
    );
  }
  if (financing.wealth_gap_cents === 0) {
    return (
      "À ce taux, emprunter et payer comptant vous laissent exactement le même patrimoine : " +
      "ni l'un ni l'autre n'est préférable."
    );
  }
  const gap = formatCents(Math.abs(financing.wealth_gap_cents));
  return financing.wealth_gap_cents > 0
    ? `Emprunter vous laisse ${gap} de plus que payer comptant, au bout de la durée du prêt.`
    : `Payer comptant vous laisse ${gap} de plus qu'emprunter, au bout de la durée du prêt.`;
}

/**
 * The rate at which borrowing stops paying, and which side of it the user's own
 * assumption falls on.
 *
 * Naming the crossing without naming where the user stands leaves the reader to
 * compare two percentages themselves, which is the arithmetic this panel exists
 * to do for them.
 */
function breakEvenSentence(financing: Financing, loanRateBps: number): string | null {
  if (financing.break_even_rate_bps === null) return financing.break_even_reason;
  const crossing = formatRateBps(financing.break_even_rate_bps);
  const yours = formatRateBps(loanRateBps);
  const side =
    loanRateBps > financing.break_even_rate_bps
      ? `Le vôtre est de ${yours}, au-dessus : à ce taux, payer comptant est préférable.`
      : loanRateBps < financing.break_even_rate_bps
        ? `Le vôtre est de ${yours}, en dessous : à ce taux, emprunter est préférable.`
        : `Le vôtre tombe exactement dessus, à ${yours} : les deux se valent.`;
  return (
    `Emprunter cesse d'être avantageux au-delà de ${crossing} : en dessous, l'argent laissé ` +
    `placé rapporte plus que le crédit ne coûte. ${side}`
  );
}

interface FinancingPanelProps {
  financing: Financing;
  /** `assumptions.loan_rate_bps` — the rate the user actually retained, which is
   *  what the break-even is compared against. */
  loanRateBps: number;
  /** Reveals the LOA fields in the form, at the other end of the page. */
  onAddLoa: () => void;
  /** True when the measured liquid balance does not cover the price today.
   *
   *  The comptant column spends the whole price on day one. When the household
   *  does not have it — the operator's balance is −2 209,63 € against a
   *  40 000 € question — every figure in this panel is a hypothesis about
   *  money the ledger says is absent, and printing "payer comptant vous laisse
   *  X de plus" beside a verdict of "hors de portée" is an assertion sitting
   *  next to a refusal of the same question. Phase 2A was fixed five times for
   *  exactly that shape. */
  cashOutOfReach: boolean;
}

export function FinancingPanel({
  financing, loanRateBps, onAddLoa, cashOutOfReach,
}: FinancingPanelProps) {
  return (
    <div className="yd-fin">
      <p className="yd-fin__lead">
        {`Les trois chemins, sur la durée du prêt (${financing.horizon_months} mois). Les montants sortis de votre poche et les mensualités sont comparables ligne à ligne ; le patrimoine à la fin ne l'est qu'entre le comptant et le crédit.`}
      </p>

      <div className="yd-fin__grid">
        {financing.options.map((option) => (
          <Column key={option.kind} option={option} onAddLoa={onAddLoa} />
        ))}
      </div>

      <p className="yd-fin__verdict">{betterSentence(financing)}</p>

      {cashOutOfReach ? (
        <p className="yd-fin__note">
          Cette comparaison suppose que vous disposez du prix le jour de l'achat. Vos relevés
          disent le contraire : la colonne « Comptant » décrit donc un chemin qui ne vous est pas
          ouvert aujourd'hui, et le patrimoine qu'elle affiche n'est pas une prévision.
        </p>
      ) : null}

      {/* Said outright, so the LOA column is never read as having lost a
          three-way race. `better_kind` deliberately excludes it: whether the
          lessee owns anything at the end is a choice the contract leaves open. */}
      <p className="yd-fin__note">
        Cette conclusion ne compare que le comptant et le crédit. La LOA n'est pas dans la course :
        selon que l'option d'achat est levée ou non, vous finissez propriétaire ou sans rien, et
        aucun patrimoine final ne peut donc lui être attribué.
      </p>

      {breakEvenSentence(financing, loanRateBps) !== null ? (
        <p className="yd-fin__crossover" data-testid="yd-fin-crossover">
          {breakEvenSentence(financing, loanRateBps)}
        </p>
      ) : null}
    </div>
  );
}
