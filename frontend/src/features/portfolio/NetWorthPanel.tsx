import { useEffect, useState } from "react";
import { Link } from "react-router";

import { NetWorthChart, MIN_NET_WORTH_POINTS } from "../../charts/NetWorthChart";
import { InfoTip } from "../../design/InfoTip";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { NetWorthReport } from "../../lib/types";
import "./NetWorthPanel.css";

/**
 * Assets minus debts, and the line of the days somebody looked.
 *
 * The screen printed « Valeur du portefeuille » and the Dettes screen
 * « Capital restant dû », and a household with 23 900 EUR of the one and
 * 11 570 EUR of the other did the subtraction itself. This panel does it,
 * names each term, and draws the history the backend snapshots once a day.
 *
 * Fetched on its own, after the page's own data: the route re-reads the
 * valuation, and firing it beside `/portfolio/valuation` would be two price
 * fetches racing for the same cache rows on a cold database.
 */
export function NetWorthPanel({ enabled }: { enabled: boolean }) {
  const [report, setReport] = useState<NetWorthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<NetWorthReport>("/portfolio/networth")
      .then((body) => {
        if (!cancelled) setReport(body);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.detail : "Une erreur inattendue est survenue.");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (error !== null) {
    return (
      <p role="alert" className="yd-networth__alert">
        {error}
      </p>
    );
  }
  if (report === null) {
    return (
      <div role="status" aria-busy="true" aria-label="Chargement du patrimoine net">
        <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
      </div>
    );
  }

  const { today, history } = report;
  const tone = today.net_cents < 0 ? "negative" : today.net_cents > 0 ? "positive" : "";

  return (
    <div className="yd-networth" data-testid="yd-networth">
      <div className="yd-networth__figure">
        <p className="yd-networth__label">
          Patrimoine net
          <InfoTip label="Comment le patrimoine net est calculé">
            Ce que vous détenez — positions au dernier cours, montants déclarés, comptes
            d'épargne au solde de vos relevés — moins le capital restant dû de vos dettes
            actives. Un relevé par jour, écrit la première fois que vous ouvrez cet écran.
          </InfoTip>
        </p>
        <p
          className={`yd-networth__amount yd-num${tone ? ` yd-networth__amount--${tone}` : ""}`}
          data-testid="yd-networth-amount"
        >
          {formatCents(today.net_cents, { signed: true })}
        </p>
      </div>

      <dl className="yd-networth__terms">
        <div className="yd-networth__term">
          <dt>Actifs</dt>
          <dd className="yd-num">{formatCents(today.assets_cents)}</dd>
        </div>
        <div className="yd-networth__term yd-networth__term--minus" aria-hidden="true">
          <span>−</span>
        </div>
        <div className="yd-networth__term">
          <dt>
            Dettes
            {today.debts_cents === 0 ? null : (
              <Link to="/dettes" className="yd-networth__link">
                voir
              </Link>
            )}
          </dt>
          <dd className="yd-num">{formatCents(today.debts_cents)}</dd>
        </div>
      </dl>

      {history.length >= MIN_NET_WORTH_POINTS ? (
        <NetWorthChart history={history} />
      ) : (
        <p className="yd-networth__note">
          {`${history.length} ${plural(history.length, "relevé", "relevés")} pour l'instant : la courbe apparaît au deuxième jour où vous ouvrez cet écran.`}
        </p>
      )}
    </div>
  );
}
