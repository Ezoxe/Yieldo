import { formatBps, formatCents, formatLatency, formatProbability, formatQuantity } from "./format";
import {
  ORDER_STATUS_LABELS,
  OUTCOME_LABELS,
  OUTCOME_TONE,
  PROVIDER_LABELS,
  RULE_LABELS,
  labelFor,
} from "./vocabulary";
import type { InvestDecisionDetail, InvestQuestion } from "../../lib/types";
import "./invest.css";

interface DecisionDetailProps {
  detail: InvestDecisionDetail;
}

/** The indicators, in the order a reader builds a picture from them. */
const FEATURE_ROWS: Array<{
  key: keyof InvestDecisionDetail["features"];
  label: string;
  kind: "cents" | "bps" | "count";
  hint?: string;
}> = [
  { key: "last_price_cents", label: "Dernier cours", kind: "cents" },
  { key: "sma_short_cents", label: "Moyenne courte", kind: "cents" },
  { key: "sma_long_cents", label: "Moyenne longue", kind: "cents" },
  { key: "trend_bps", label: "Tendance", kind: "bps",
    hint: "L'écart entre les deux moyennes. Positif : la courte est au-dessus." },
  { key: "momentum_bps", label: "Momentum", kind: "bps",
    hint: "La variation sur la fenêtre de momentum." },
  { key: "rsi_bps", label: "RSI", kind: "bps",
    hint: "50 % : ni acheteurs ni vendeurs n'ont pris l'avantage sur la fenêtre." },
  { key: "volatility_bps", label: "Volatilité", kind: "bps",
    hint: "L'écart-type des variations période à période." },
  { key: "drawdown_bps", label: "Repli depuis le plus haut", kind: "bps" },
  { key: "range_position_bps", label: "Position dans le canal", kind: "bps",
    hint: "0 % au plus bas de la fenêtre, 100 % au plus haut." },
  { key: "closes_seen", label: "Cours observés", kind: "count" },
];

function featureValue(value: number | undefined, kind: "cents" | "bps" | "count"): string {
  if (value === undefined) return "—";
  if (kind === "cents") return formatCents(value);
  if (kind === "bps") return formatBps(value, { signed: true });
  return String(value);
}

function questionText(question: InvestQuestion): string {
  return question.prompt ?? question.statement ?? question.key;
}

/**
 * One decision, unfolded: what the model saw, what it was asked, what it
 * answered, what the mandate said, and what was sent.
 *
 * **The whole point of this component is that nothing in it is a summary.**
 * `features` is the dataclass the indicators engine produced, `questions` are
 * the questions as they were asked at the time (not as the catalogue holds
 * them today), `answers` are the typed answers beside the provider's raw
 * payload, and the verdict is the mandate's own. A reader following a euro
 * through this screen can see every step that moved it.
 *
 * Read-only by construction: it takes a detail and renders it. Nothing here
 * can start, stop or change anything.
 */
export function DecisionDetail({ detail }: DecisionDetailProps) {
  const answers = detail.answers ?? {};
  const verdict = detail.risk_verdict;
  const order = detail.order;

  return (
    <div className="yd-detail">
      <section className="yd-detail__section">
        <h4 className="yd-detail__heading">Issue</h4>
        <p className="yd-detail__answer">
          <span className={`yd-pill yd-pill--${OUTCOME_TONE[detail.outcome]}`}>
            {OUTCOME_LABELS[detail.outcome]}
          </span>
          {detail.rule ? (
            <span className="yd-pill yd-pill--neutral">
              {labelFor(RULE_LABELS, detail.rule)}
            </span>
          ) : null}
        </p>
        {/* The backend's own French sentence, printed verbatim: it owns every
            user-facing wording in this application. */}
        {detail.message ? <p className="yd-note">{detail.message}</p> : null}
      </section>

      <section className="yd-detail__section">
        <h4 className="yd-detail__heading">
          Ce que le modèle a vu
        </h4>
        <div className="yd-scroll-x">
          <table className="yd-table">
            <caption className="yd-visually-hidden">
              Les indicateurs calculés par Yieldo et transmis au modèle
            </caption>
            <thead>
              <tr>
                <th scope="col">Indicateur</th>
                <th scope="col" className="yd-num">Valeur</th>
                <th scope="col">Lecture</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row) => (
                <tr key={String(row.key)}>
                  <th scope="row">{row.label}</th>
                  <td className="yd-num">
                    {featureValue(detail.features[row.key] as number | undefined, row.kind)}
                  </td>
                  <td className="yd-feed__message">{row.hint ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="yd-note">
          Aucun titre d'actualité, aucun texte écrit par un tiers&nbsp;: le modèle ne reçoit
          que ces chiffres, calculés par Yieldo sur{" "}
          {detail.features.closes_seen ?? "?"} cours.
        </p>
      </section>

      <section className="yd-detail__section">
        <h4 className="yd-detail__heading">Ce qu'on lui a demandé, et ce qu'il a répondu</h4>
        {detail.questions.map((question) => {
          const answer = answers[question.key];
          return (
            <div key={question.key} className="yd-detail__question">
              <p className="yd-detail__prompt">{questionText(question)}</p>
              {question.options?.length ? (
                <p className="yd-detail__prompt">
                  Options possibles&nbsp;:{" "}
                  {question.options.map((option) => `« ${option} »`).join(", ")}.
                </p>
              ) : null}
              {answer ? (
                <p className="yd-detail__answer">
                  {answer.choice !== null && answer.choice !== undefined ? (
                    <span className="yd-pill yd-pill--accent">{answer.choice}</span>
                  ) : null}
                  {answer.score_value !== null && answer.score_value !== undefined ? (
                    <span className="yd-num">
                      {answer.score_value}&nbsp;/&nbsp;{question.maximum ?? 10}
                    </span>
                  ) : null}
                  {answer.probability_bps !== null && answer.probability_bps !== undefined ? (
                    <span className="yd-num">{formatProbability(answer.probability_bps)}</span>
                  ) : null}
                  <span className="yd-feed__time">{formatLatency(answer.latency_ms)}</span>
                  {answer.confidence_bps !== null && answer.confidence_bps !== undefined ? (
                    <span className="yd-feed__time">
                      confiance annoncée {formatProbability(answer.confidence_bps)}
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="yd-note">
                  Question non posée&nbsp;: le modèle avait déjà répondu « ne rien faire ».
                </p>
              )}
            </div>
          );
        })}
        <p className="yd-note">
          Répondu par {labelFor(PROVIDER_LABELS, detail.provider)}
          {detail.model ? ` (${detail.model})` : ""}, en {formatLatency(detail.latency_ms)} au
          total. Le modèle n'a choisi aucune taille de position&nbsp;: elle est calculée par
          Yieldo à partir de ces trois réponses.
        </p>
      </section>

      {verdict ? (
        <section className="yd-detail__section">
          <h4 className="yd-detail__heading">Ce que le mandat en a fait</h4>
          <p className="yd-detail__answer">
            <span
              className={`yd-pill yd-pill--${
                verdict.decision === "allowed"
                  ? "positive"
                  : verdict.decision === "reduced"
                    ? "warning"
                    : "negative"
              }`}
            >
              {verdict.decision === "allowed"
                ? "Autorisé"
                : verdict.decision === "reduced"
                  ? "Réduit"
                  : "Refusé"}
            </span>
            <span className="yd-num">{formatQuantity(verdict.quantity)}</span>
            <span className="yd-num">{formatCents(verdict.notional_cents)}</span>
          </p>
          {verdict.breaches.length ? (
            <ul className="yd-detail__breaches">
              {verdict.breaches.map((breach) => (
                <li key={`${breach.rule}-${breach.observed}`} className="yd-detail__breach">
                  <strong>{labelFor(RULE_LABELS, breach.rule)}</strong>
                  <span>{breach.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="yd-note">Aucune limite du mandat n'a été approchée.</p>
          )}
        </section>
      ) : null}

      {order ? (
        <section className="yd-detail__section">
          <h4 className="yd-detail__heading">L'ordre</h4>
          <div className="yd-scroll-x">
            <table className="yd-table">
              <caption className="yd-visually-hidden">L'ordre produit par cette décision</caption>
              <tbody>
                <tr>
                  <th scope="row">État</th>
                  <td>{labelFor(ORDER_STATUS_LABELS, order.status)}</td>
                </tr>
                <tr>
                  <th scope="row">Sens</th>
                  <td>{order.side === "buy" ? "Achat" : "Vente"}</td>
                </tr>
                <tr>
                  <th scope="row">Quantité transmise</th>
                  <td className="yd-num">{formatQuantity(order.quantity)}</td>
                </tr>
                <tr>
                  <th scope="row">Quantité demandée</th>
                  <td className="yd-num">{formatQuantity(order.requested_quantity)}</td>
                </tr>
                <tr>
                  <th scope="row">Montant</th>
                  <td className="yd-num">{formatCents(order.notional_cents)}</td>
                </tr>
                {order.average_price_cents !== null ? (
                  <tr>
                    <th scope="row">Prix moyen obtenu</th>
                    <td className="yd-num">{formatCents(order.average_price_cents)}</td>
                  </tr>
                ) : null}
                {order.cost_cents > 0 ? (
                  <tr>
                    <th scope="row">Coût d'exécution</th>
                    <td className="yd-num">{formatCents(order.cost_cents)}</td>
                  </tr>
                ) : null}
                {order.realised_pnl_cents !== 0 ? (
                  <tr>
                    <th scope="row">Résultat réalisé</th>
                    <td className="yd-num">
                      {formatCents(order.realised_pnl_cents, { signed: true })}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {order.failure_reason ? <p className="yd-note">{order.failure_reason}</p> : null}
        </section>
      ) : null}

      <section className="yd-detail__section">
        <h4 className="yd-detail__heading">Empreinte des entrées</h4>
        <p className="yd-detail__hash">{detail.inputs_hash}</p>
        <p className="yd-note">
          L'empreinte des indicateurs et des questions au moment où ils ont été enregistrés.
          Supervision → Rejouer la recalcule&nbsp;: si elle a changé, cette ligne a été
          modifiée après coup.
        </p>
      </section>
    </div>
  );
}
