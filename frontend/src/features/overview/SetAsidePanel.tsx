import { CountUp } from "../../design/CountUp";
import { SavingsIcon } from "../../design/icons";
import { InfoTip } from "../../design/InfoTip";
import { PanelHead } from "../../design/bento/PanelHead";
import { formatCents } from "../../design/theme";
import type { Summary } from "../../lib/types";
import "./SetAsidePanel.css";

/**
 * Three figures, never added up.
 *
 * What the period produces, what actually left for a savings account, and the
 * difference between the two. The third is why this panel exists: it says
 * whether the theoretical surplus lands anywhere.
 *
 * The addition is the trap this panel must refuse on screen exactly as
 * `engines/transfer.py` refuses it on the server: a euro moved to a livret is
 * ALREADY inside the net, because nothing spends it any more. So the three
 * numbers stand side by side with a "−" and an "=" between them, never a "+".
 */

/** What the gap says, in the three registers it deserves. */
export function gapSentence(gapCents: number, setAsideCents: number): string {
  if (setAsideCents === 0 && gapCents === 0) {
    return (
      "Cette période n'a rien dégagé et rien mis de côté : entrées et sorties " +
      "s'équilibrent exactement."
    );
  }
  if (gapCents > 0) {
    return (
      `${formatCents(gapCents)} sont restés sur votre compte courant — dégagés par la ` +
      "période, mais jamais déplacés vers un compte d'épargne."
    );
  }
  if (gapCents < 0) {
    return (
      `Vous avez mis ${formatCents(Math.abs(gapCents))} de plus de côté que la période ` +
      "n'a dégagé : la différence a été prise sur votre solde."
    );
  }
  return "Tout ce que la période a dégagé est parti vers l'épargne, à l'euro près.";
}

interface SetAsidePanelProps {
  summary: Summary;
}

export function SetAsidePanel({ summary }: SetAsidePanelProps) {
  return (
    <>
      <PanelHead icon={SavingsIcon}>
        Ce que la période a mis de côté
        <InfoTip label="Comment ce chiffre est mesuré">
          <p>
            Un virement vers un compte d'épargne n'est pas une dépense : il ne quitte pas
            votre patrimoine. Yieldo l'écarte donc des entrées et des sorties, et le
            compte ici, séparément.
          </p>
          <p>
            Les trois chiffres ne s'additionnent pas. L'euro viré au livret est déjà
            compté dans « ce que la période dégage », puisque plus rien ne le dépense.
            L'écart est ce qui reste sur le compte courant.
          </p>
          <p>
            Mesuré sur les opérations classées « Épargne et investissement », et sur les
            versements reçus par vos comptes d'épargne dont Yieldo ne voit pas le débit
            d'origine. Une même opération n'est jamais comptée deux fois.
          </p>
        </InfoTip>
      </PanelHead>

      <div className="yd-setaside">
        <div className="yd-setaside__figure">
          <span className="yd-setaside__label">Ce que la période dégage</span>
          <CountUp
            className="yd-num yd-setaside__value"
            value={summary.net_cents}
            format={formatCents}
          />
        </div>

        <span className="yd-setaside__operator" aria-hidden="true">
          −
        </span>

        <div className="yd-setaside__figure">
          <span className="yd-setaside__label">Réellement mis de côté</span>
          <CountUp
            className="yd-num yd-setaside__value yd-setaside__value--aside"
            value={summary.set_aside_cents}
            format={formatCents}
          />
        </div>

        <span className="yd-setaside__operator" aria-hidden="true">
          =
        </span>

        <div className="yd-setaside__figure yd-setaside__figure--gap">
          <span className="yd-setaside__label">Resté sur le compte courant</span>
          <CountUp
            className={`yd-num yd-setaside__value ${
              summary.set_aside_gap_cents < 0 ? "yd-setaside__value--short" : ""
            }`}
            value={summary.set_aside_gap_cents}
            format={formatCents}
          />
        </div>
      </div>

      <p className="yd-setaside__note">
        {gapSentence(summary.set_aside_gap_cents, summary.set_aside_cents)}
      </p>
    </>
  );
}
