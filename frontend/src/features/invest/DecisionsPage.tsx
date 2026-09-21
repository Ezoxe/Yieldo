import { useState } from "react";

import { PageHead } from "../../design/PageHead";
import { PageSkeleton } from "../../design/PageSkeleton";
import { DecisionsIcon } from "../../design/icons";
import { useApiQuery } from "../../lib/useApiQuery";
import type { DecisionOutcome, InvestDecision } from "../../lib/types";
import { DecisionFeed } from "./DecisionFeed";
import { OUTCOME_LABELS } from "./vocabulary";
import "./invest.css";

const OUTCOMES: DecisionOutcome[] = ["skipped", "held", "refused", "ordered", "failed"];

/**
 * How many rows are drawn before the reader asks for more.
 *
 * The feed used to render everything the route returned, and a pipeline run
 * sixty times over five instruments made a page twelve thousand pixels tall —
 * measured in a browser, not guessed. Fifty rows is a screenful or two, which
 * is what a feed is for; the rest is one click away and the count above says
 * how much of it there is.
 */
const PAGE = 50;

/**
 * Every decision the pilot has taken, filterable, each one unfoldable.
 *
 * **Including the ones where nothing happened.** A feed that showed only the
 * orders would answer "what did it do" and hide "what did it decide not to
 * do", which is the larger and more interesting half: a pilot that examined
 * two hundred instruments and traded two is telling you about a hundred and
 * ninety-eight judgements.
 *
 * One filter row above the list, per the interaction rules — never a filter
 * hidden behind a menu on a screen whose whole job is looking.
 */
export function DecisionsPage() {
  const [outcome, setOutcome] = useState<DecisionOutcome | "">("");
  const [symbol, setSymbol] = useState("");
  const [shown, setShown] = useState(PAGE);

  const decisions = useApiQuery<InvestDecision[]>("/invest/decisions", {
    limit: 200,
    outcome: outcome || undefined,
    symbol: symbol.trim().toUpperCase() || undefined,
  });

  return (
    <div className="yd-invest-page">
      <PageHead
        icon={DecisionsIcon}
        title="Décisions"
        shortLead="Tout ce que le pilote a décidé, y compris de ne rien faire."
      >
        <p>
          Chaque ligne est un instrument passé une fois dans le pilotage. Dépliez-la pour voir
          les indicateurs qu'a reçus le modèle, la question exacte qui lui a été posée, sa
          réponse typée, ce que le mandat en a fait et l'ordre qui en est sorti — ou la règle
          qui l'a arrêté.
        </p>
      </PageHead>

      <div className="yd-invest-actions" role="group" aria-label="Filtres">
        <label className="yd-invest-field">
          <span>Issue</span>
          <select
            className="yd-select"
            value={outcome}
            onChange={(event) => {
              setOutcome(event.target.value as DecisionOutcome | "");
              setShown(PAGE);
            }}
          >
            <option value="">Toutes</option>
            {OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {OUTCOME_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="yd-invest-field">
          <span>Instrument</span>
          <input
            className="yd-input"
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value);
              setShown(PAGE);
            }}
            placeholder="BTC-EUR"
          />
        </label>
      </div>

      {decisions.isPending ? (
        <PageSkeleton />
      ) : decisions.error ? (
        <p className="yd-note yd-note--negative">{decisions.error.detail}</p>
      ) : (
        <>
          <p className="yd-note">
            {decisions.data.length} décision(s) retenue(s) par ces filtres,{" "}
            {Math.min(shown, decisions.data.length)} affichée(s).
          </p>
          <DecisionFeed decisions={decisions.data} limit={shown} />
          {decisions.data.length > shown ? (
            <div className="yd-invest-actions">
              <button
                type="button"
                className="yd-button"
                onClick={() => setShown((current) => current + PAGE)}
              >
                Afficher {Math.min(PAGE, decisions.data.length - shown)} de plus
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
