import { useState } from "react";

import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { PageHead } from "../../design/PageHead";
import { PageSkeleton } from "../../design/PageSkeleton";
import { BrokersIcon, SandboxIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";
import { useApiQuery, useInvalidate } from "../../lib/useApiQuery";
import type { InvestMode, InvestVenue, InvestVenueCheck } from "../../lib/types";
import { formatDateTime } from "./format";
import { MODE_LABELS, PRICE_SOURCE_LABELS, VENUE_LABELS, labelFor } from "./vocabulary";
import "./invest.css";

/** What each venue offers, in the words someone choosing between them needs. */
const VENUE_NOTES: Record<string, string> = {
  internal:
    "Aucune clé, aucun appel sortant. Le marché est fabriqué par Yieldo et toujours "
    + "ouvert : c'est là qu'on regarde le pilote réfléchir un dimanche soir.",
  alpaca:
    "Actions et ETF américains. Son environnement papier est la même API que le réel, au "
    + "même format : une stratégie qui marche en papier ne découvre rien en passant au réel.",
  kraken:
    "Crypto, ouvert en permanence. Kraken n'a pas d'environnement de test : en mode papier, "
    + "les cours sont ceux de Kraken et l'exécution est simulée par Yieldo.",
  binance:
    "Crypto, avec un testnet complet : en mode papier l'ordre est vraiment apparié par un "
    + "carnet, sans qu'aucun argent n'existe.",
};

const VENUES = ["internal", "alpaca", "kraken", "binance"] as const;

/**
 * The brokers, and the wall around their credentials.
 *
 * **Reading this screen never shows a key.** The API has nowhere to put one in
 * a response, and neither has this component: a connection says whether
 * credentials are on file and when they last worked.
 *
 * **Paper and live are separate connections, not a toggle.** They are separate
 * rows with separate credentials, so "going live" is connecting a live broker
 * with its own key — there is no switch that turns a rehearsal into the real
 * thing by accident.
 */
export function BrokersPage() {
  const venues = useApiQuery<InvestVenue[]>("/invest/venues");
  const invalidate = useInvalidate();

  const [venue, setVenue] = useState<string>("internal");
  const [mode, setMode] = useState<InvestMode>("paper");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [slippage, setSlippage] = useState("10");
  const [priceSource, setPriceSource] = useState("");
  const [result, setResult] = useState<InvestVenueCheck | null>(null);
  const [busy, setBusy] = useState(false);

  const needsCredentials = venue !== "internal";

  const connect = async () => {
    setBusy(true);
    setResult(null);
    try {
      const response = await api.post<InvestVenueCheck>("/invest/venues", {
        venue,
        mode: venue === "internal" ? "paper" : mode,
        label: label.trim() || labelFor(VENUE_LABELS, venue),
        api_key: apiKey.trim() || null,
        api_secret: apiSecret.trim() || null,
        base_url: baseUrl.trim() || null,
        slippage_bps: Number(slippage) || 0,
        price_source: priceSource || null,
      });
      setResult(response);
      if (response.valid) {
        setApiKey("");
        setApiSecret("");
        await invalidate("/invest/venues");
      }
    } catch (error) {
      setResult({
        valid: false,
        message: error instanceof ApiError ? error.detail : "La connexion a échoué.",
      });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (id: number) => {
    const response = await api.post<InvestVenueCheck>(`/invest/venues/${id}/verifier`, {});
    setResult(response);
    await invalidate("/invest/venues");
  };

  const remove = async (id: number) => {
    await api.delete(`/invest/venues/${id}`);
    await invalidate("/invest/venues");
  };

  if (venues.isPending) return <PageSkeleton />;

  return (
    <div className="yd-invest-page">
      <PageHead
        icon={BrokersIcon}
        title="Courtiers"
        shortLead="Où partent les ordres, et les clés qui l'autorisent."
      >
        <p>
          Les clés sont chiffrées avant d'être écrites et ne sont jamais relues à l'écran.
          Enregistrer une connexion la vérifie par un appel réel&nbsp;: ce que le courtier
          répond est affiché tel quel. Une clé d'accès Yieldo ne peut ni connecter ni
          supprimer un courtier — seule une session le peut.
        </p>
      </PageHead>

      <BentoGrid>
        <BentoCell span={{ base: 1, md: 6, lg: 7 }}>
          <PanelHead icon={BrokersIcon} subtitle={`${venues.data?.length ?? 0} connexion(s)`}>
            Connexions enregistrées
          </PanelHead>
          {(venues.data?.length ?? 0) === 0 ? (
            <p className="yd-note">
              Aucun courtier connecté. Commencez par le carnet simulé de Yieldo&nbsp;: il ne
              demande aucune clé et son marché est toujours ouvert.
            </p>
          ) : (
            <div className="yd-scroll-x">
              <table className="yd-table">
                <caption className="yd-visually-hidden">
                  Les courtiers connectés, leur mode et l'état de leur dernière vérification
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Courtier</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Cours</th>
                    <th scope="col">Dernière vérification</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {venues.data?.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        {row.label}
                        <br />
                        <small className="yd-feed__time">
                          {labelFor(VENUE_LABELS, row.venue)}
                          {row.requires_credentials
                            ? row.configured ? " · clé enregistrée" : " · sans clé"
                            : " · aucune clé nécessaire"}
                        </small>
                      </th>
                      <td>
                        <span
                          className={`yd-pill yd-pill--${row.mode === "live" ? "negative" : "info"}`}
                        >
                          {MODE_LABELS[row.mode]}
                        </span>
                      </td>
                      <td>{labelFor(PRICE_SOURCE_LABELS, row.price_source)}</td>
                      <td>
                        {row.last_check_at ? (
                          <>
                            <span
                              className={`yd-pill yd-pill--${row.last_check_ok ? "positive" : "negative"}`}
                            >
                              {row.last_check_ok ? "Répond" : "En échec"}
                            </span>
                            <br />
                            <small className="yd-feed__time">
                              {formatDateTime(row.last_check_at)}
                            </small>
                            {row.last_check_message ? (
                              <>
                                <br />
                                <small className="yd-feed__message">{row.last_check_message}</small>
                              </>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <div className="yd-invest-actions">
                          <button type="button" className="yd-button yd-button--quiet"
                                  onClick={() => void verify(row.id)}>
                            Vérifier
                          </button>
                          <button type="button" className="yd-button yd-button--quiet"
                                  onClick={() => void remove(row.id)}>
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 5 }}>
          <PanelHead icon={SandboxIcon}>Connecter un courtier</PanelHead>
          <div className="yd-invest-form">
            <label className="yd-invest-field">
              <span>Place de marché</span>
              <select className="yd-select" value={venue}
                      onChange={(event) => setVenue(event.target.value)}>
                {VENUES.map((value) => (
                  <option key={value} value={value}>{labelFor(VENUE_LABELS, value)}</option>
                ))}
              </select>
              <small>{VENUE_NOTES[venue]}</small>
            </label>

            {venue !== "internal" ? (
              <label className="yd-invest-field">
                <span>Mode</span>
                <select className="yd-select" value={mode}
                        onChange={(event) => setMode(event.target.value as InvestMode)}>
                  <option value="paper">Papier — argent fictif</option>
                  <option value="live">Réel — votre argent</option>
                </select>
                <small>
                  Papier et réel sont deux connexions distinctes, avec deux clés distinctes.
                </small>
              </label>
            ) : null}

            <label className="yd-invest-field">
              <span>Nom affiché</span>
              <input className="yd-input" value={label}
                     onChange={(event) => setLabel(event.target.value)}
                     placeholder={labelFor(VENUE_LABELS, venue)} />
            </label>

            {needsCredentials ? (
              <>
                <label className="yd-invest-field">
                  <span>Clé</span>
                  <input className="yd-input" value={apiKey} autoComplete="off"
                         onChange={(event) => setApiKey(event.target.value)} />
                </label>
                <label className="yd-invest-field">
                  <span>Secret</span>
                  <input className="yd-input" type="password" value={apiSecret}
                         autoComplete="off"
                         onChange={(event) => setApiSecret(event.target.value)} />
                  <small>
                    Chiffré avant d'être écrit, jamais relu à l'écran. Chez le courtier,
                    n'accordez à cette clé que la négociation — jamais le retrait de fonds.
                  </small>
                </label>
                <label className="yd-invest-field">
                  <span>Adresse (facultatif)</span>
                  <input className="yd-input" value={baseUrl}
                         onChange={(event) => setBaseUrl(event.target.value)}
                         placeholder="https://…" />
                  <small>Pour un testnet ou une passerelle auto-hébergée.</small>
                </label>
              </>
            ) : (
              <>
                <label className="yd-invest-field">
                  <span>Source des cours</span>
                  <select className="yd-select" value={priceSource || "synthetic"}
                          onChange={(event) => setPriceSource(event.target.value)}>
                    <option value="synthetic">{PRICE_SOURCE_LABELS.synthetic}</option>
                    <option value="market">{PRICE_SOURCE_LABELS.market}</option>
                  </select>
                </label>
                <label className="yd-invest-field">
                  <span>Écart d'exécution simulé (points de base)</span>
                  <input className="yd-input yd-num" inputMode="numeric" value={slippage}
                         onChange={(event) => setSlippage(event.target.value)} />
                  <small>
                    Ce que l'exécution coûte au-delà du cours affiché. Un simulateur qui
                    n'en facture aucun flatte toutes les stratégies qui y tournent.
                  </small>
                </label>
              </>
            )}

            <div className="yd-invest-actions">
              <button type="button" className="yd-button yd-button--primary"
                      onClick={() => void connect()} disabled={busy}>
                {busy ? "Vérification…" : "Connecter et vérifier"}
              </button>
            </div>

            {result ? (
              <p className={`yd-note yd-note--${result.valid ? "positive" : "negative"}`}
                 role="status">
                {result.message}
              </p>
            ) : null}
          </div>
        </BentoCell>
      </BentoGrid>
    </div>
  );
}
