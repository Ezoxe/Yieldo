import { useState } from "react";

import { useApiQuery } from "../../lib/useApiQuery";
import type { InvestDecision, InvestDecisionDetail } from "../../lib/types";
import { DecisionDetail } from "./DecisionDetail";
import { formatProbability, formatTime } from "./format";
import { OUTCOME_LABELS, OUTCOME_SHORT, OUTCOME_TONE } from "./vocabulary";
import "./invest.css";

/**
 * What a row says beside its badge.
 *
 * The backend writes a French sentence on every decision that was STOPPED by
 * something — a prefilter, a threshold, a risk rule, a failure — because a
 * refusal has to name its cause. A decision that went all the way through was
 * stopped by nothing, so it carries no sentence, and the row was printing an
 * em dash: a line that said less than the silence around it.
 *
 * So the fallback is built from the answers the row already carries. It is not
 * a summary invented here — every part of it is a stored typed answer.
 */
function summaryOf(decision: InvestDecision): string {
  if (decision.message) return decision.message;
  const direction = decision.answers?.direction?.choice;
  const conviction = decision.answers?.conviction?.score_value;
  const probability = decision.answers?.continuation?.probability_bps;
  if (!direction) return OUTCOME_LABELS[decision.outcome];
  const parts = [direction];
  if (conviction !== null && conviction !== undefined) parts.push(`conviction ${conviction}/10`);
  if (probability !== null && probability !== undefined) {
    parts.push(`probabilité ${formatProbability(probability)}`);
  }
  return parts.join(" — ");
}

interface DecisionFeedProps {
  decisions: InvestDecision[];
  limit?: number;
}

/**
 * The decisions, newest first, each one unfoldable into what it actually saw.
 *
 * Collapsed by default and expanded one at a time: the detail is six sections
 * long, and a feed that opened all of them would be a wall rather than a feed.
 * The summary row carries everything needed to decide whether to open it — the
 * instrument, the outcome, the rule that produced it and the time.
 *
 * The detail is fetched when the row is opened rather than with the list: the
 * list route deliberately does not return the context, the questions and the
 * verdict, because forty of those is a payload nobody reads.
 */
export function DecisionFeed({ decisions, limit }: DecisionFeedProps) {
  const [openId, setOpenId] = useState<number | null>(null);
  const shown = limit ? decisions.slice(0, limit) : decisions;

  if (shown.length === 0) {
    return (
      <p className="yd-note">
        Aucune décision enregistrée. Lancez un tour depuis la Salle de contrôle&nbsp;: chaque
        instrument autorisé par le mandat y passera, et ce qu'il est advenu de lui apparaîtra
        ici — y compris quand il ne s'est rien passé.
      </p>
    );
  }

  return (
    <ul className="yd-feed">
      {shown.map((decision) => (
        <li key={decision.id} className="yd-feed__item">
          <button
            type="button"
            className="yd-feed__summary"
            aria-expanded={openId === decision.id}
            onClick={() => setOpenId((current) => (current === decision.id ? null : decision.id))}
          >
            <span className="yd-feed__symbol">{decision.symbol}</span>
            <span className="yd-feed__message">
              <span className={`yd-pill yd-pill--${OUTCOME_TONE[decision.outcome]}`}>
                {OUTCOME_SHORT[decision.outcome]}
              </span>{" "}
              {summaryOf(decision)}
            </span>
            <span className="yd-feed__time">{formatTime(decision.created_at)}</span>
          </button>
          {openId === decision.id ? (
            <div className="yd-feed__detail">
              <LoadedDetail id={decision.id} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LoadedDetail({ id }: { id: number }) {
  const detail = useApiQuery<InvestDecisionDetail>(`/invest/decisions/${id}`);
  if (detail.isPending) return <p className="yd-note">Lecture de la décision…</p>;
  if (detail.error) return <p className="yd-note">{detail.error.detail}</p>;
  return <DecisionDetail detail={detail.data} />;
}
