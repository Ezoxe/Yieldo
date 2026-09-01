import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import type { Challenge, ChallengeKind } from "../../lib/types";

/**
 * What `target_cents` actually measured, for this kind of challenge.
 *
 * One integer column carries four different measurements — a subscription's
 * own charge, a category's rise against its level a year ago, a transaction's
 * excess over its category's median, and a budget's typical monthly overage.
 * Printing the amount without this label would be a figure with no measurement
 * behind it, which design §10 exists to forbid.
 */
export function challengeFigureLabel(kind: ChallengeKind): string {
  switch (kind) {
    case "unused_subscription":
      return "Coût du prélèvement";
    case "category_above_past_level":
      return "Écart sur un an";
    case "anomaly":
      return "Écart avec l'habitude de la catégorie";
    case "budget_overrun":
      return "Dépassement typique par mois";
  }
}

/*
 * There is deliberately NO kind badge on a challenge card.
 *
 * All four titles `engines/challenge.py` emits already name their own kind —
 * "Abonnement « X »", "« X » au-dessus de son niveau d'il y a un an",
 * "Dépense inhabituelle : X", "Budget « X » dépassé" — so a chip above the
 * title would repeat the first words of the title back at the reader. Rendered
 * at 1440 it read "DÉPENSE INHABITUELLE" directly above "Dépense inhabituelle :
 * CARTE X1234 FNAC DARTY", which is precisely the decorative element the
 * phase's closing rule forbids: "aucun élément qui ne corresponde pas à une
 * action mesurable". What the kind actually changes on screen is what
 * `target_cents` MEANS, and `challengeFigureLabel` above carries that.
 */

/**
 * The before/after comparison `engines/challenge.py` actually made.
 *
 * **Positive means the category spent LESS**, which is the opposite of how a
 * signed amount usually reads on this app's screens — so the direction is
 * written out in words and the amount is printed as an unsigned magnitude
 * beside it. A signed "+42,10 €" here would be read as extra spending by
 * anyone who has used the rest of Yieldo.
 */
export function outcomeSentence(measuredCents: number, measuredOn: string): string {
  const when = `Résultat mesuré le ${frenchDate(measuredOn)}`;
  if (measuredCents === 0) {
    return `${when} : cette catégorie a dépensé exactement autant que le mois précédant l'acceptation.`;
  }
  const direction = measuredCents > 0 ? "de moins" : "de plus";
  return (
    `${when} : ${formatCents(Math.abs(measuredCents))} ${direction} dépensés dans cette ` +
    "catégorie que le mois précédant l'acceptation."
  );
}

/** Which category the outcome will be, or was, measured on. Never blank and
 *  never invented: the comparison happens at category granularity, so the
 *  reader has to know which one. */
function categorySentence(challenge: Challenge, names: Map<number, string>): string {
  if (challenge.category_id === null) {
    return "Aucune catégorie n'est associée à ce défi : son résultat ne pourra pas être mesuré.";
  }
  const name = names.get(challenge.category_id);
  return name === undefined
    ? `Catégorie suivie : identifiant ${challenge.category_id}, dont le nom n'a pas pu être retrouvé.`
    : `Catégorie suivie : ${name}.`;
}

interface ChallengeListProps {
  challenges: Challenge[];
  categoryNames: Map<number, string>;
  onDecide: (id: number, decision: "accept" | "reject") => void;
  /** The row whose decision is in flight. Both its buttons go disabled; every
   *  other row stays live. */
  pendingId?: number | null;
}

/**
 * Design §6.2's "défis dérivés des données : acceptables ou rejetables, avec
 * suivi du résultat réel le mois suivant".
 *
 * Nothing here is a badge, a level or a streak bonus. Each card is one
 * measurement four already-shipped engines made, the span it was measured
 * over, and two buttons. A challenge Yieldo could not quantify was never
 * proposed at all (`engines/challenge.py`), so a short list is the honest
 * answer and is never padded to look fuller.
 */
export function ChallengeList({
  challenges,
  categoryNames,
  onDecide,
  pendingId = null,
}: ChallengeListProps) {
  if (challenges.length === 0) {
    return (
      <p className="yd-suivi__note">
        Aucun défi proposé. Un défi n'est proposé que lorsque Yieldo peut le chiffrer sur vos
        propres relevés — un abonnement récurrent, une catégorie au-dessus de son niveau d'il y a
        un an, une dépense qui s'écarte de l'habitude de sa catégorie, ou un budget dépassé
        plusieurs mois de suite. Rien n'est inventé pour remplir la liste.
      </p>
    );
  }

  return (
    <>
      {/* Said before the buttons, not after: accepting starts a measurement,
          and the reader is entitled to know what will be measured before
          committing to it. */}
      <p className="yd-suivi__note">
        Accepter un défi enregistre la date du jour. Yieldo compare ensuite ce que la catégorie
        concernée a dépensé sur le <strong>mois complet précédent</strong> avec le mois complet
        suivant : c'est cette différence, et rien d'autre, qui est rapportée comme résultat.
      </p>

      <ul className="yd-challenges">
        {challenges.map((challenge) => {
          const pending = pendingId === challenge.id;
          return (
            <li
              key={challenge.id}
              className={`yd-challenge yd-challenge--${challenge.state}`}
              data-testid={`yd-challenge-${challenge.id}`}
            >
              <h3 className="yd-challenge__title">{challenge.title}</h3>

              {challenge.target_cents !== null ? (
                <p className="yd-challenge__figure">
                  <span className="yd-challenge__figure-label">
                    {challengeFigureLabel(challenge.kind)}
                  </span>
                  <span className="yd-challenge__figure-value">
                    {formatCents(challenge.target_cents)}
                  </span>
                </p>
              ) : null}

              {/* The engine's own sentence, naming the span the figure rests
                  on — occurrences, months compared, months overrun. */}
              <p className="yd-challenge__detail">{challenge.detail}</p>
              <p className="yd-suivi__note">{categorySentence(challenge, categoryNames)}</p>
              <p className="yd-suivi__note">{`Proposé le ${frenchDate(challenge.proposed_on)}.`}</p>

              {challenge.state === "proposed" ? (
                <div className="yd-challenge__actions">
                  <button
                    type="button"
                    className="yd-challenge__action yd-challenge__action--accept"
                    disabled={pending}
                    onClick={() => onDecide(challenge.id, "accept")}
                  >
                    {/* The title lives in the accessible name, not in the
                        visible label: a screen reader hears which card it is
                        on, and the button stays a button. */}
                    <span className="sr-only">{`Accepter le défi : ${challenge.title}`}</span>
                    <span aria-hidden="true">Accepter</span>
                  </button>
                  <button
                    type="button"
                    className="yd-challenge__action"
                    disabled={pending}
                    onClick={() => onDecide(challenge.id, "reject")}
                  >
                    <span className="sr-only">{`Rejeter le défi : ${challenge.title}`}</span>
                    <span aria-hidden="true">Rejeter</span>
                  </button>
                </div>
              ) : challenge.state === "accepted" ? (
                <>
                  <p className="yd-challenge__state">
                    {challenge.decided_on !== null
                      ? `Accepté le ${frenchDate(challenge.decided_on)}.`
                      : "Accepté."}
                  </p>
                  {challenge.measured_cents !== null && challenge.measured_on !== null ? (
                    <p className="yd-challenge__outcome">
                      {outcomeSentence(challenge.measured_cents, challenge.measured_on)}
                    </p>
                  ) : challenge.outcome_unavailable_reason !== null ? (
                    // Verbatim. It names WHICH of four causes applies — too
                    // soon, the month is not imported, no baseline, or no
                    // category at all — and they are four different waits.
                    <p className="yd-suivi__refusal">{challenge.outcome_unavailable_reason}</p>
                  ) : (
                    <p className="yd-suivi__refusal">
                      Aucun résultat n'a été mesuré et le serveur n'a pas indiqué pourquoi.
                    </p>
                  )}
                </>
              ) : (
                <p className="yd-challenge__state">
                  {challenge.decided_on !== null
                    ? `Rejeté le ${frenchDate(challenge.decided_on)}.`
                    : "Rejeté."}
                  {" Aucun résultat n'est mesuré sur un défi rejeté : il n'y a pas d'engagement à comparer."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
