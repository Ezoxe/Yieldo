import { useState } from "react";

import { useApiQuery } from "../../lib/useApiQuery";
import type { InvestDecision, InvestDecisionDetail } from "../../lib/types";
import { DecisionDetail } from "./DecisionDetail";
import { formatTime } from "./format";
import { OUTCOME_SHORT, OUTCOME_TONE, RULE_LABELS, labelFor } from "./vocabulary";
import "./invest.css";

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
              {decision.message ?? labelFor(RULE_LABELS, decision.rule)}
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
