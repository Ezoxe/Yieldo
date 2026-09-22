import { useEffect, useState } from "react";

import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { EmptyState } from "../../design/EmptyState";
import { InfoTip } from "../../design/InfoTip";
import { PageHead } from "../../design/PageHead";
import { PageSkeleton } from "../../design/PageSkeleton";
import { CalendarIcon, DecisionsIcon, SandboxIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { InvestSession, InvestSessionDetail } from "../../lib/types";
import { useApiQuery, useInvalidate } from "../../lib/useApiQuery";
import { formatBps, formatCents, formatLatency, formatProbability } from "./format";
import { PipelineFunnel } from "./PipelineFunnel";
import { CapitalChart, MarketChart, MassChart } from "./SessionCharts";
import { PROVIDER_LABELS, labelFor } from "./vocabulary";
import "./invest.css";

const DEFAULT_STEPS = 78;
const POLL_MS = 2_000;

const STATUS_LABELS: Record<string, string> = {
  running: "En cours",
  finished: "Terminée",
  stopped: "Arrêtée",
  failed: "En échec",
};

const STATUS_TONE: Record<string, string> = {
  running: "info",
  finished: "positive",
  stopped: "warning",
  failed: "negative",
};

/** Three instruments share a row; one takes it; two or four go in pairs. */
function instrumentSpan(count: number): number {
  if (count <= 1) return 12;
  if (count % 3 === 0) return 4;
  return 6;
}

function seedLabel(seed: number): string {
  return seed.toLocaleString("fr-FR").replace(/\s/g, " ");
}

/** « +1,25 % » on a gain, « −3,40 % » on a loss, « 0,00 % » flat. */
function signedBps(bps: number): string {
  return formatBps(bps, { signed: true });
}

/**
 * La journée simulée : 78 pas de marché synthétique contre le modèle
 * configuré, en arrière-plan, et tout ce qu'elle a produit.
 *
 * Un tour à la fois ne dit rien ; la question « fait-il du profit ? » ne se
 * pose que sur une séance. Le marché du bac à sable est déterministe par
 * numéro de journée : le même numéro rejoue les mêmes cours sous un autre
 * modèle ou un autre mandat, et c'est ce qui fait de la comparaison une
 * mesure plutôt que deux anecdotes.
 */
export function SessionPage() {
  const days = useApiQuery<InvestSession[]>("/invest/sessions");
  const invalidate = useInvalidate();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cash, setCash] = useState("10000");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = days.data?.find((day) => day.status === "running") ?? null;
  const currentId = running?.id ?? selectedId ?? days.data?.[0]?.id ?? null;
  const detail = useApiQuery<InvestSessionDetail>(
    `/invest/sessions/${currentId ?? 0}`, undefined,
    { enabled: currentId !== null, refetchInterval: running ? POLL_MS : false },
  );

  // While a day runs, the list must follow it too, so the row moves from
  // « En cours » to its verdict without a reload.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void invalidate("/invest/sessions"), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, invalidate]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await api.post<InvestSession>("/invest/sessions", {
        steps: DEFAULT_STEPS,
        seed: seed.trim() === "" ? null : Number(seed),
        cash_cents: Math.round(Number(cash.replace(",", ".")) * 100),
      });
      setSelectedId(started.id);
      await invalidate("/invest/sessions");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "La journée n'a pas pu être lancée.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!running) return;
    setBusy(true);
    try {
      await api.post(`/invest/sessions/${running.id}/stop`, {});
      await invalidate("/invest/sessions");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "La journée n'a pas pu être arrêtée.");
    } finally {
      setBusy(false);
    }
  };

  if (days.isPending) return <PageSkeleton />;

  const day = detail.data ?? null;
  const report = day?.report ?? null;

  return (
    <div className="yd-invest-page">
      <PageHead
        icon={CalendarIcon}
        title="La journée"
        shortLead="Une séance entière contre le modèle, et ce qu'il en reste."
      >
        <p>
          Soixante-dix-huit pas de marché synthétique — une séance de 6 h 30 à cinq minutes —
          joués d'un trait contre le modèle configuré, avec le mandat tel quel. Le numéro de
          la journée fixe les cours&nbsp;: le même numéro rejoue exactement le même marché sous
          un autre modèle ou un autre mandat. C'est là que se lit si le modèle fait mieux que
          quatre règles de momentum, et à quel prix.
        </p>
      </PageHead>

      <div className="yd-invest-form yd-session__launch">
        <div className="yd-invest-grid">
          <label className="yd-invest-field">
            <span>Montant de départ (€)</span>
            <input className="yd-input yd-num" inputMode="decimal" value={cash}
                   onChange={(event) => setCash(event.target.value)} />
            <small>Le bac à sable est remis à ce montant, sans position, avant le premier pas.</small>
          </label>
          <label className="yd-invest-field">
            <span>Rejouer la journée n°</span>
            <input className="yd-input yd-num" inputMode="numeric" value={seed}
                   onChange={(event) => setSeed(event.target.value)}
                   placeholder="tirée au sort" />
            <small>Vide&nbsp;: un numéro est tiré au sort et affiché, pour la rejouer plus tard.</small>
          </label>
        </div>
        <div className="yd-invest-actions">
          <button type="button" className="yd-button yd-button--primary"
                  onClick={() => void start()} disabled={busy || running !== null}>
            {busy && !running ? "Lancement…" : "Lancer la journée"}
          </button>
          {running ? (
            <button type="button" className="yd-button yd-button--danger"
                    onClick={() => void stop()} disabled={busy || running.stop_requested}>
              {running.stop_requested ? "Arrêt demandé…" : "Arrêter la journée"}
            </button>
          ) : null}
        </div>
        {error ? <p className="yd-note yd-note--negative" role="alert">{error}</p> : null}
        {running ? (
          <div className="yd-session__progress">
            <div
              className="yd-session__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={running.steps}
              aria-valuenow={running.completed_steps}
              aria-label="Avancement de la journée"
            >
              <span style={{ inlineSize: `${(running.completed_steps / running.steps) * 100}%` }} />
            </div>
            <p className="yd-feed__time">
              Journée n°&nbsp;{seedLabel(running.seed)} — {running.completed_steps} pas sur{" "}
              {running.steps}, {running.decisions}{" "}
              {plural(running.decisions, "décision", "décisions")}, {running.orders}{" "}
              {plural(running.orders, "ordre", "ordres")}. Le modèle est interrogé à chaque pas
              sur chaque instrument&nbsp;; comptez quelques minutes.
            </p>
          </div>
        ) : null}
      </div>

      {days.data && days.data.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title="Aucune journée simulée pour l'instant."
          detail="Lancez-en une : le bac à sable est remis à zéro, le marché part d'un numéro tiré au sort, et le modèle est interrogé à chaque pas. Le bilan s'affiche ici pendant qu'elle tourne."
        />
      ) : null}

      {day && report ? (
        <BentoGrid>
          <BentoCell span={{ base: 1, md: 6, lg: 12 }}>
            <PanelHead
              icon={SandboxIcon}
              subtitle={
                `Journée n° ${seedLabel(day.seed)} · ${labelFor(PROVIDER_LABELS, day.provider)}`
                + `${day.model ? ` (${day.model})` : ""} · ${day.completed_steps} pas sur ${day.steps}`
              }
              actions={
                <>
                  {day.completed_steps > 3 ? (
                    <a
                      className="yd-button yd-button--quiet"
                      href={`/api/invest/sessions/${day.id}/entrainement`}
                      download
                    >
                      Exporter pour l'entraînement
                    </a>
                  ) : null}
                  <span className={`yd-pill yd-pill--${STATUS_TONE[day.status] ?? "neutral"}`}>
                    {STATUS_LABELS[day.status] ?? day.status}
                  </span>
                </>
              }
            >
              Le bilan
            </PanelHead>
            {day.message ? (
              <p className="yd-note yd-note--negative" role="status">{day.message}</p>
            ) : null}
            <div className="yd-figures yd-figures--wide">
              <div className="yd-figure">
                <span className="yd-figure__label">Rendement du jour</span>
                <span className={`yd-figure__value yd-num${
                  report.return_bps > 0 ? " yd-figure__value--positive"
                    : report.return_bps < 0 ? " yd-figure__value--negative" : ""}`}>
                  {signedBps(report.return_bps)}
                </span>
                <span className="yd-figure__note">
                  {formatCents(day.initial_cash_cents)} → {formatCents(report.final_equity_cents)}
                </span>
              </div>
              <div className="yd-figure">
                <span className="yd-figure__label">Repli maximal</span>
                <span className="yd-figure__value yd-num">
                  {report.max_drawdown_bps > 0 ? `−${formatBps(report.max_drawdown_bps)}` : formatBps(0)}
                </span>
                <span className="yd-figure__note">depuis le plus haut de la journée</span>
              </div>
              <div className="yd-figure">
                <span className="yd-figure__label">Résultat</span>
                <span className="yd-figure__value yd-num">
                  {formatCents(report.realised_pnl_cents)}
                </span>
                <span className="yd-figure__note">
                  réalisé, {formatCents(day.unrealised_pnl_cents)} latent
                </span>
              </div>
              <div className="yd-figure">
                <span className="yd-figure__label">Ordres exécutés</span>
                <span className="yd-figure__value yd-num">{report.filled}</span>
                <span className="yd-figure__note">
                  {report.winning} {plural(report.winning, "gagnant", "gagnants")},{" "}
                  {report.losing} {plural(report.losing, "perdant", "perdants")}
                  {report.refused > 0
                    ? ` · ${report.refused} ${plural(report.refused, "refusé par le mandat", "refusés par le mandat")}`
                    : ""}
                </span>
              </div>
              <div className="yd-figure">
                <span className="yd-figure__label">Accord avec les règles</span>
                <span className="yd-figure__value yd-num">
                  {report.compared > 0 ? formatProbability(report.agreement_bps) : "—"}
                </span>
                <span className="yd-figure__note">
                  sur {report.compared} {plural(report.compared, "décision", "décisions")}
                </span>
              </div>
              <div className="yd-figure">
                <span className="yd-figure__label">Le modèle</span>
                <span className="yd-figure__value yd-num">
                  {report.mean_confidence_bps !== null
                    ? formatProbability(report.mean_confidence_bps) : "—"}
                </span>
                <span className="yd-figure__note">
                  de confiance en moyenne
                  {report.mean_act_bps !== null ? `, agir ${formatProbability(report.mean_act_bps)}` : ""}
                  , {formatLatency(report.latency_p50_ms)} par question
                </span>
              </div>
            </div>
          </BentoCell>

          <BentoCell span={{ base: 1, md: 6, lg: 7 }}>
            <PanelHead icon={SandboxIcon} subtitle="Capital et liquidités, pas par pas">
              Le capital
            </PanelHead>
            {day.points.length > 1 ? (
              <CapitalChart day={day} />
            ) : (
              <p className="yd-note">La courbe se dessine dès le deuxième pas.</p>
            )}
          </BentoCell>

          <BentoCell span={{ base: 1, md: 6, lg: 5 }}>
            <PanelHead
              icon={DecisionsIcon}
              subtitle={`${report.decisions} ${plural(report.decisions, "décision", "décisions")}`}
            >
              Où sont parties les décisions
            </PanelHead>
            <PipelineFunnel
              examined={report.decisions}
              stages={[
                { outcome: "skipped", count: report.decisions - report.held - report.refused
                  - report.ordered - report.failed },
                { outcome: "held", count: report.held },
                { outcome: "refused", count: report.refused },
                { outcome: "ordered", count: report.ordered },
                { outcome: "failed", count: report.failed },
              ]}
            />
          </BentoCell>

          {day.symbols.map((symbol) => (
            <BentoCell key={symbol} span={{ base: 1, md: 6, lg: instrumentSpan(day.symbols.length) }}>
              <PanelHead
                icon={DecisionsIcon}
                subtitle="Le cours synthétique, les achats et les ventes"
                actions={
                  <InfoTip label="Comment lire ce graphique">
                    Le cours est celui du carnet simulé pour cette journée, recalculé depuis
                    son numéro. Chaque repère est un ordre exécuté&nbsp;: A pour un achat, V
                    pour une vente. Survolez un pas pour lire ce que le modèle a répondu, sa
                    masse par option, et ce que les règles auraient dit.
                  </InfoTip>
                }
              >
                {symbol}
              </PanelHead>
              {day.closes[symbol]?.length ? (
                <>
                  <MarketChart day={day} symbol={symbol} />
                  {day.report.mass_series[symbol]?.length ? (
                    <>
                      <h4 className="yd-detail__heading">Ce que le modèle a dit</h4>
                      <MassChart day={day} symbol={symbol} />
                    </>
                  ) : null}
                </>
              ) : (
                <p className="yd-note">Aucun pas joué sur cet instrument.</p>
              )}
            </BentoCell>
          ))}
        </BentoGrid>
      ) : null}

      {days.data && days.data.length > 0 ? (
        <section className="yd-session__history">
          <PanelHead icon={CalendarIcon} subtitle="Les vingt dernières">
            Journées précédentes
          </PanelHead>
          <ul className="yd-opinions" aria-label="Journées précédentes">
            {days.data.map((row) => {
              const outcome = row.final_equity_cents !== null
                ? Math.round(((row.final_equity_cents - row.initial_cash_cents) * 10_000)
                  / row.initial_cash_cents)
                : null;
              return (
                <li key={row.id} className="yd-feed__item">
                  <div className="yd-feed__summary yd-session__row">
                    <button
                      type="button"
                      className="yd-session__pick"
                      onClick={() => setSelectedId(row.id)}
                      aria-current={row.id === currentId ? "true" : undefined}
                    >
                      <span className="yd-feed__symbol yd-num">n°&nbsp;{seedLabel(row.seed)}</span>
                      <span className="yd-feed__message">
                        {labelFor(PROVIDER_LABELS, row.provider)}
                        {row.model ? ` (${row.model})` : ""} · {row.completed_steps} pas ·{" "}
                        {row.orders} {plural(row.orders, "ordre", "ordres")}
                      </span>
                      <span className={`yd-pill yd-pill--${STATUS_TONE[row.status] ?? "neutral"}`}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                      <span className={`yd-num${
                        outcome === null ? "" : outcome > 0 ? " yd-figure__value--positive"
                          : outcome < 0 ? " yd-figure__value--negative" : ""}`}>
                        {outcome === null ? "—" : signedBps(outcome)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="yd-button yd-button--quiet"
                      onClick={() => setSeed(String(row.seed))}
                      aria-label={`Rejouer la journée n° ${row.seed}`}
                    >
                      Rejouer
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
