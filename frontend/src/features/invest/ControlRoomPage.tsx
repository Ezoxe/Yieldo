import { useState } from "react";
import { Link } from "react-router";

import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { EmptyState } from "../../design/EmptyState";
import { InfoTip } from "../../design/InfoTip";
import { PageHead } from "../../design/PageHead";
import { PageSkeleton } from "../../design/PageSkeleton";
import {
  BrokersIcon,
  ControlRoomIcon,
  DecisionModelIcon,
  DecisionsIcon,
  HaltIcon,
  OversightIcon,
  SandboxIcon,
} from "../../design/icons";
import { parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { useApiQuery, useInvalidate } from "../../lib/useApiQuery";
import type { InvestDecision, InvestOverview, InvestRun } from "../../lib/types";
import { plural } from "../../lib/plural";
import { CalibrationPlot } from "./CalibrationPlot";
import { DecisionFeed } from "./DecisionFeed";
import { PipelineFunnel } from "./PipelineFunnel";
import {
  formatBps,
  formatCents,
  formatLatency,
  formatQuantity,
  quantityIsShortened,
  remainingMinutes,
} from "./format";
import { AUTONOMY_EXPLAINED, AUTONOMY_LABELS, MODE_LABELS, VENUE_LABELS, labelFor } from "./vocabulary";
import "./invest.css";

/**
 * The Salle de contrôle: what the pilot is doing, right now, and the one
 * control that stops it.
 *
 * Laid out in the order someone walking up to a running machine reads it:
 * **is it running and under what authority**, then **what it has done to the
 * money**, then **where the instruments went**, then **is the model any
 * good**, then **the decisions themselves**. The emergency stop sits in the
 * first screenful on every width, because a control you have to scroll to is
 * not an emergency control.
 *
 * Every figure here was computed by an engine and returned by
 * `GET /api/invest/overview`. This screen does no arithmetic of its own beyond
 * turning basis points into French.
 */
export function ControlRoomPage() {
  const overview = useApiQuery<InvestOverview>("/invest/overview");
  const decisions = useApiQuery<InvestDecision[]>("/invest/decisions", { limit: 40 });
  const invalidate = useInvalidate();

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<InvestRun | null>(null);
  const [haltReason, setHaltReason] = useState("");
  const [haltOpen, setHaltOpen] = useState(false);
  const [funding, setFunding] = useState("10000.00");

  const refresh = async () => {
    await Promise.all([invalidate("/invest/overview"), invalidate("/invest/decisions")]);
  };

  const runCycle = async () => {
    setRunning(true);
    setRunError(null);
    try {
      setLastRun(await api.post<InvestRun>("/invest/run", {}));
      await refresh();
    } catch (error) {
      // The backend's own French sentence, verbatim. It names the cause and
      // the screen that fixes it; paraphrasing would lose the remedy.
      setRunError(error instanceof ApiError ? error.detail : "Le tour n'a pas pu être lancé.");
    } finally {
      setRunning(false);
    }
  };

  const halt = async () => {
    const reason = haltReason.trim();
    if (!reason) return;
    try {
      await api.post("/invest/oversight/halt", { reason });
      setHaltOpen(false);
      setHaltReason("");
      await refresh();
    } catch (error) {
      setRunError(error instanceof ApiError ? error.detail : "L'arrêt n'a pas pu être enregistré.");
    }
  };

  // Crediting the sandbox is the same route that resets it: putting the paper
  // account back to a starting balance IS funding it. A fresh account starts
  // at zero, which is correct — nobody should be handed imaginary money by
  // default — but it means the first thing a household needs on this screen is
  // a way to put some there.
  const fund = async () => {
    const cents = parseCents(funding);
    if (cents === null || cents < 0) return;
    try {
      await api.post(`/invest/sandbox/reset?cash_cents=${cents}`, {});
      await refresh();
    } catch (error) {
      setRunError(
        error instanceof ApiError ? error.detail : "Le bac à sable n'a pas pu être crédité.",
      );
    }
  };

  const resume = async () => {
    try {
      await api.post("/invest/policy/resume", {});
      await refresh();
    } catch (error) {
      setRunError(error instanceof ApiError ? error.detail : "La relance a échoué.");
    }
  };

  if (overview.isPending) return <PageSkeleton />;
  if (overview.error) {
    return (
      <div className="yd-invest-page">
        <PageHead icon={ControlRoomIcon} title="Salle de contrôle" />
        <EmptyState
          icon={ControlRoomIcon}
          title="Le pilotage n'a pas pu être lu"
          detail={overview.error.detail}
        />
      </div>
    );
  }

  const data = overview.data;
  const armedMinutes = remainingMinutes(data.armed_until);
  const unrealised = data.unrealised_pnl_cents;
  const totalResult = data.realised_pnl_total_cents + unrealised;

  return (
    <div className="yd-invest-page">
      <PageHead
        icon={ControlRoomIcon}
        title="Salle de contrôle"
        shortLead="Ce que le pilote fait en ce moment, et le bouton qui l'arrête."
      >
        <p>
          Le pilotage tourne en mode <strong>{AUTONOMY_LABELS[data.autonomy]}</strong>{" "}
          {data.venue ? (
            <>
              sur <strong>{labelFor(VENUE_LABELS, data.venue.venue)}</strong>{" "}
              ({MODE_LABELS[data.venue.mode]})
            </>
          ) : (
            <>sans courtier connecté</>
          )}
          . {AUTONOMY_EXPLAINED[data.autonomy]}
        </p>
      </PageHead>

      {/* The one thing that must never be below the fold. */}
      {data.halted ? (
        <div className="yd-note yd-note--negative" role="status">
          <strong>Le pilotage est à l'arrêt.</strong>{" "}
          {data.halted_reason ? `Raison enregistrée : ${data.halted_reason}. ` : ""}
          Aucun ordre ne sera transmis. Seule une session Yieldo peut le relancer.
          <div className="yd-invest-actions" style={{ marginTop: 8 }}>
            <button type="button" className="yd-button" onClick={() => void resume()}>
              Relancer le pilotage
            </button>
          </div>
        </div>
      ) : null}

      {data.autonomy === "live" && !data.armed ? (
        <div className="yd-note yd-note--warning" role="status">
          Le mode réel est choisi mais l'exécution n'est <strong>pas armée</strong> : chaque
          ordre sera refusé. Armez-la dans <Link to="/invest/mandat">le mandat</Link> — elle se
          désarme ensuite toute seule.
        </div>
      ) : null}

      {data.armed && armedMinutes !== null ? (
        <div className="yd-note yd-note--positive" role="status">
          <strong>Exécution réelle armée</strong> — il reste environ {armedMinutes}{" "}
          {plural(armedMinutes, "minute", "minutes")}
          avant le désarmement automatique.
        </div>
      ) : null}

      {data.mode === "paper" && data.equity_cents === 0 ? (
        <div className="yd-note yd-note--warning" role="status">
          <strong>Le bac à sable est vide.</strong> Un compte papier neuf ne contient rien —
          personne ne devrait recevoir de l'argent imaginaire par défaut. Créditez-le pour que
          le pilote ait de quoi travailler&nbsp;; c'est de l'argent fictif, et le remettre à
          zéro efface aussi les positions.
          <div className="yd-invest-grid" style={{ marginTop: 8 }}>
            <label className="yd-invest-field">
              <span>Montant de départ (€)</span>
              <input
                className="yd-input yd-num"
                inputMode="decimal"
                value={funding}
                onChange={(event) => setFunding(event.target.value)}
              />
            </label>
          </div>
          <div className="yd-invest-actions" style={{ marginTop: 8 }}>
            <button type="button" className="yd-button yd-button--primary"
                    onClick={() => void fund()}>
              Créditer le bac à sable
            </button>
          </div>
        </div>
      ) : null}

      <div className="yd-invest-actions">
        <button
          type="button"
          className="yd-button yd-button--primary"
          onClick={() => void runCycle()}
          disabled={running || data.halted}
        >
          {running ? "Tour en cours…" : "Lancer un tour"}
        </button>
        {data.halted ? null : (
          <button
            type="button"
            className="yd-button yd-button--danger"
            onClick={() => setHaltOpen((open) => !open)}
            aria-expanded={haltOpen}
          >
            <HaltIcon /> Arrêt d'urgence
          </button>
        )}
        <Link to="/invest/decisions" className="yd-button">
          <DecisionsIcon /> Toutes les décisions
        </Link>
      </div>

      {haltOpen ? (
        <div className="yd-note yd-note--warning">
          <label className="yd-invest-field">
            <span>Pourquoi arrêtez-vous le pilotage&nbsp;?</span>
            <input
              className="yd-input"
              value={haltReason}
              onChange={(event) => setHaltReason(event.target.value)}
              placeholder="Écart de calibration anormal"
            />
            <small>
              La raison est enregistrée dans le journal scellé. Un arrêt désarme aussi
              l'exécution réelle.
            </small>
          </label>
          <div className="yd-invest-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="yd-button yd-button--danger"
              onClick={() => void halt()}
              disabled={!haltReason.trim()}
            >
              Arrêter maintenant
            </button>
            <button type="button" className="yd-button" onClick={() => setHaltOpen(false)}>
              Annuler
            </button>
          </div>
        </div>
      ) : null}

      {runError ? (
        <div className="yd-note yd-note--negative" role="alert">
          {runError}
        </div>
      ) : null}

      {lastRun ? (
        <div className="yd-note" role="status">
          {lastRun.summary}
        </div>
      ) : null}

      <BentoGrid>
        <BentoCell span={{ base: 1, md: 6, lg: 4 }}>
          <PanelHead icon={SandboxIcon} subtitle={`En ${MODE_LABELS[data.mode].toLowerCase()}`}>
            Le compte
          </PanelHead>
          <div className="yd-figures">
            <div className="yd-figure">
              <span className="yd-figure__label">Capital</span>
              <span className="yd-figure__value yd-num">{formatCents(data.equity_cents)}</span>
              <span className="yd-figure__note">
                dont {formatCents(data.cash_cents)} en liquidités
              </span>
            </div>
            <div className="yd-figure">
              <span className="yd-figure__label">Résultat total</span>
              <span
                className={`yd-figure__value yd-num${
                  totalResult === 0 ? "" : totalResult > 0 ? " yd-figure__value--positive" : " yd-figure__value--negative"
                }`}
              >
                {formatCents(totalResult, { signed: true })}
              </span>
              <span className="yd-figure__note">
                {formatCents(data.realised_pnl_total_cents, { signed: true })} réalisé,{" "}
                {formatCents(unrealised, { signed: true })} latent
              </span>
            </div>
            <div className="yd-figure">
              <span className="yd-figure__label">Repli</span>
              <span className="yd-figure__value yd-num">{formatBps(data.drawdown_bps)}</span>
              <span className="yd-figure__note">
                depuis {formatCents(data.peak_equity_cents)}
              </span>
            </div>
            <div className="yd-figure">
              <span className="yd-figure__label">Ordres aujourd'hui</span>
              <span className="yd-figure__value yd-num">{data.orders_today}</span>
              <span className="yd-figure__note">
                {formatCents(data.realised_pnl_today_cents, { signed: true })} réalisé ce jour
              </span>
            </div>
          </div>
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 8 }}>
          <PanelHead
            icon={DecisionsIcon}
            subtitle={`${data.examined} ${plural(data.examined, "instrument examiné", "instruments examinés")}`}
            actions={
              <InfoTip label="Comment lire l'entonnoir">
                Chaque instrument passe par les mêmes étapes&nbsp;: d'abord les règles qui
                répondent sans consulter le modèle, puis le modèle, puis les seuils, puis le
                mandat. Une ligne dit combien d'instruments se sont arrêtés là.
              </InfoTip>
            }
          >
            Où sont partis les instruments
          </PanelHead>
          <PipelineFunnel
            examined={data.examined}
            stages={[
              { outcome: "skipped", count: data.skipped },
              { outcome: "held", count: data.held },
              { outcome: "refused", count: data.refused },
              { outcome: "ordered", count: data.ordered },
              { outcome: "failed", count: data.failed },
            ]}
          />
          <p className="yd-note yd-push-down">
            Latence du modèle&nbsp;: {formatLatency(data.latency_median_ms)} en médiane,{" "}
            {formatLatency(data.latency_worst_ms)} au pire.
          </p>
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 12 }}>
          <PanelHead icon={BrokersIcon} subtitle={`${data.positions.length} ${plural(data.positions.length, "ligne", "lignes")}`}>
            Les positions
          </PanelHead>
          {data.positions.length === 0 ? (
            <p className="yd-note">Aucune position ouverte en ce moment.</p>
          ) : (
            <div className="yd-scroll-x">
              <table className="yd-table">
                <caption className="yd-visually-hidden">
                  Les positions tenues par le pilotage, avec leur valeur et leur plus-value
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Instrument</th>
                    <th scope="col" className="yd-num">Quantité</th>
                    <th scope="col" className="yd-num">Prix de revient</th>
                    <th scope="col" className="yd-num">Cours</th>
                    <th scope="col" className="yd-num">Valeur</th>
                    <th scope="col" className="yd-num">Latent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.positions.map((position) => (
                    <tr key={position.symbol}>
                      <th scope="row">{position.symbol}</th>
                      <td
                        className="yd-num"
                        title={
                          quantityIsShortened(position.quantity)
                            ? `Quantité exacte enregistrée : ${position.quantity}`
                            : undefined
                        }
                      >
                        {formatQuantity(position.quantity)}
                      </td>
                      <td className="yd-num">{formatCents(position.average_price_cents)}</td>
                      {/* A price that could not be read is said, never replaced
                          by a stale one. */}
                      <td className="yd-num">
                        {position.price_cents === null
                          ? "cours indisponible"
                          : formatCents(position.price_cents)}
                      </td>
                      <td className="yd-num">
                        {position.market_value_cents === null
                          ? "—"
                          : formatCents(position.market_value_cents)}
                      </td>
                      <td className="yd-num">
                        {position.unrealised_pnl_cents === null
                          ? "—"
                          : formatCents(position.unrealised_pnl_cents, { signed: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 5 }}>
          <PanelHead
            icon={DecisionModelIcon}
            subtitle={`${data.calibration.observations} ${plural(data.calibration.observations, "décision probabilisée", "décisions probabilisées")}`}
            actions={
              <InfoTip label="Ce que mesure la calibration">
                Un modèle qui dit « 65 % » devrait avoir raison environ soixante-cinq fois sur
                cent. Avoir raison quatre-vingt-dix fois en disant 65 % n'est pas un meilleur
                modèle&nbsp;: c'est un modèle dont les nombres ne veulent pas dire ce qu'ils
                disent, et le mandat dimensionne les positions à partir de ces nombres.
              </InfoTip>
            }
          >
            Le modèle dit-il vrai&nbsp;?
          </PanelHead>
          <p className="yd-note">{data.calibration.verdict}</p>
          {data.calibration.buckets.length ? (
            <CalibrationPlot buckets={data.calibration.buckets} />
          ) : (
            <p className="yd-note">
              Le score de Brier sera calculé quand assez de décisions probabilisées auront été
              suivies d'un tour suivant.
            </p>
          )}
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 7 }}>
          <PanelHead
            icon={OversightIcon}
            subtitle="Les plus récentes"
            actions={
              <Link to="/invest/decisions" className="yd-button yd-button--quiet">
                Tout voir
              </Link>
            }
          >
            Les décisions, en direct
          </PanelHead>
          {decisions.error ? (
            <p className="yd-note">{decisions.error.detail}</p>
          ) : (
            <DecisionFeed decisions={decisions.data ?? []} limit={12} />
          )}
        </BentoCell>
      </BentoGrid>

      <p className="yd-note">
        Le mandat et ses limites se règlent dans <Link to="/invest/mandat">Mandat</Link>, le
        modèle dans <Link to="/invest/modele">Modèle de décision</Link>, et le journal scellé
        se vérifie dans <Link to="/invest/supervision">Supervision</Link>.
      </p>
    </div>
  );
}
