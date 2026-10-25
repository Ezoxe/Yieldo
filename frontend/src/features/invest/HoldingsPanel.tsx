import { useState } from "react";

import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { InvestVenueHoldings } from "../../lib/types";
import { formatDateTime, formatQuantity } from "./format";
import { MODE_LABELS, labelFor } from "./vocabulary";

/** « 1 520,35 USD » — a broker's figure stays in the broker's currency. */
function money(cents: number, currency: string | null): string {
  return formatCents(cents, { currency: currency === "EUR" || currency === null ? "€" : currency });
}

/**
 * « Ce que vous détenez » — cash and positions, read at the brokers on demand.
 *
 * Read only: Yieldo asks each connected broker what the account holds and
 * shows the answer with the moment it was asked. Nothing is stored and no
 * order route is called; a read-only key is enough. A broker that could not
 * be read keeps its card, with its own refusal on it.
 */
export function HoldingsPanel() {
  const [cards, setCards] = useState<InvestVenueHoldings[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      setCards(await api.get<InvestVenueHoldings[]>("/invest/avoirs"));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "La lecture des avoirs a échoué.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="yd-holdings">
      <p className="yd-note">
        Lecture seule&nbsp;: Yieldo demande à chaque courtier connecté ce que le compte contient,
        sans passer d'ordre ni rien enregistrer. Une clé en lecture seule suffit.
      </p>
      <button type="button" className="yd-button yd-button--primary" onClick={read} disabled={busy}>
        {busy ? "Lecture en cours…" : cards === null ? "Lire mes avoirs" : "Relire"}
      </button>

      {error !== null ? (
        <p className="yd-note yd-note--negative" role="alert">
          {error}
        </p>
      ) : null}

      {cards !== null && cards.length === 0 ? (
        <p className="yd-note">
          Aucun courtier réel connecté&nbsp;: le carnet simulé n'a pas d'avoirs à lire.
          Connectez Alpaca, Kraken ou Binance ci-dessus.
        </p>
      ) : null}

      {cards?.map((card) => (
        <section key={card.venue_id} className="yd-holdings__card" aria-label={card.label}>
          <header className="yd-holdings__head">
            <strong>{card.label}</strong>
            <span className={`yd-pill yd-pill--${card.mode === "live" ? "negative" : "info"}`}>
              {labelFor(MODE_LABELS, card.mode)}
            </span>
            <span className="yd-holdings__when">lu le {formatDateTime(card.fetched_at)}</span>
          </header>

          {!card.ok ? (
            <p className="yd-note yd-note--negative" role="status">
              {card.message}
            </p>
          ) : (
            <>
              <p className="yd-holdings__cash">
                Liquidités&nbsp;:{" "}
                {card.cash.length === 0
                  ? "aucune"
                  : card.cash.map((line) => (
                      <span key={line.currency} className="yd-num">
                        {money(line.amount_cents, line.currency)}
                      </span>
                    ))}
              </p>
              {card.assets.length === 0 ? (
                <p className="yd-note">Aucune position.</p>
              ) : (
                <div className="yd-scroll-x">
                  <table className="yd-table">
                    <thead>
                      <tr>
                        <th scope="col">Actif</th>
                        <th scope="col">Quantité</th>
                        <th scope="col">Valeur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.assets.map((asset) => (
                        <tr key={asset.symbol}>
                          <td>{asset.symbol}</td>
                          <td className="yd-num" title={asset.quantity}>
                            {formatQuantity(asset.quantity, 8)}
                          </td>
                          <td className="yd-num">
                            {asset.value_cents === null
                              ? "non fournie par le courtier"
                              : money(asset.value_cents, asset.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
