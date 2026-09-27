import { useEffect, useState } from "react";
import { Link } from "react-router";

import { PanelHead } from "../../design/bento/PanelHead";
import { CashflowIcon, ChevronIcon } from "../../design/icons";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { Outlook } from "../../lib/types";
import { dayLabel, lowPointContext, riskPill } from "../avenir/answers";
import "../avenir/AvenirPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";
const SHOWN_EVENTS = 3;

/**
 * The dashboard's one look forward: the current accounts' low point over the
 * next thirty days, with its risk, and the next three known events. The rest
 * lives on Avenir.
 */
export function NextDaysPanel() {
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Outlook>("/outlook", { scope: "checking", horizon_days: 30 })
      .then((value) => {
        if (!cancelled) setOutlook(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const link = (
    <Link className="yd-nextdays__link" to="/avenir">
      Voir l'avenir
      <ChevronIcon />
    </Link>
  );

  return (
    <div className="yd-nextdays">
      <PanelHead icon={CashflowIcon} actions={link}>Les 30 prochains jours</PanelHead>
      {error !== null ? <p role="alert" className="yd-avenir__sub">{error}</p> : null}
      {outlook?.empty_reason ? <p className="yd-avenir__sub">{outlook.empty_reason}</p> : null}
      {outlook !== null && outlook.low_point !== null ? (
        <div className="yd-nextdays__body">
          <div className="yd-nextdays__low">
            <span className="yd-avenir__sub">Point bas</span>
            <span className="yd-avenir__figure yd-num">
              {formatCents(outlook.low_point.p50_cents, { signed: true })}
            </span>
            <span className="yd-avenir__sub">
              {[dayLabel(outlook.low_point.on), lowPointContext(outlook)].filter(Boolean).join(", ")}
            </span>
            <span className={`yd-avenir__pill yd-avenir__pill--${riskPill(outlook).tone}`}>
              {riskPill(outlook).text}
            </span>
          </div>
          <ul className="yd-nextdays__events">
            {outlook.events.slice(0, SHOWN_EVENTS).map((event) => (
              <li key={`${event.series}-${event.on}`}>
                <span className="yd-avenir__sub">{dayLabel(event.on)}</span>
                <span>{event.label}</span>
                <span className={`yd-num${event.amount_cents > 0 ? " is-income" : ""}`}>
                  {formatCents(event.amount_cents, { signed: true })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
