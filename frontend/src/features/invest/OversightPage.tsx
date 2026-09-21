import { useState } from "react";

import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { PageHead } from "../../design/PageHead";
import { PageSkeleton } from "../../design/PageSkeleton";
import { DecisionsIcon, OversightIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";
import { useApiQuery } from "../../lib/useApiQuery";
import type { InvestJournal, InvestReplay } from "../../lib/types";
import { plural } from "../../lib/plural";
import { formatDateTime } from "./format";
import { ACTOR_LABELS, JOURNAL_KIND_LABELS, labelFor } from "./vocabulary";
import "./invest.css";

/**
 * Le journal scellé, le rejeu d'une décision, et ce qu'une IA extérieure peut
 * en faire.
 *
 * Trois questions, dans l'ordre où quelqu'un qui doute les pose :
 *
 * 1. **Le journal a-t-il été modifié&nbsp;?** Chaque entrée porte l'empreinte
 *    de la précédente. Une entrée changée ou supprimée après coup casse la
 *    chaîne, et la vérification dit à quel rang.
 * 2. **Cette décision-là est-elle reproductible&nbsp;?** Le rejeu recalcule
 *    l'empreinte des entrées enregistrées, puis repose les mêmes questions au
 *    modèle configuré. Les deux réponses sont séparées à dessein : une ligne
 *    modifiée et un modèle qui a changé d'avis ne se soignent pas pareil.
 * 3. **Comment faire vérifier tout ça par quelqu'un d'autre&nbsp;?** La clé
 *    d'accès de Réglages ouvre les mêmes routes en lecture, plus l'arrêt
 *    d'urgence. Elle n'ouvre ni le mandat, ni l'armement, ni les courtiers.
 */
export function OversightPage() {
  const journal = useApiQuery<InvestJournal>("/invest/oversight/journal", { limit: 200 });
  const [decisionId, setDecisionId] = useState("");
  const [replay, setReplay] = useState<InvestReplay | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runReplay = async () => {
    const id = Number(decisionId);
    if (!Number.isInteger(id) || id <= 0) return;
    setBusy(true);
    setReplay(null);
    setReplayError(null);
    try {
      setReplay(await api.post<InvestReplay>(`/invest/oversight/replay/${id}`, {}));
    } catch (error) {
      setReplayError(error instanceof ApiError ? error.detail : "Le rejeu a échoué.");
    } finally {
      setBusy(false);
    }
  };

  if (journal.isPending) return <PageSkeleton />;

  const chain = journal.data;

  return (
    <div className="yd-invest-page">
      <PageHead
        icon={OversightIcon}
        title="Supervision"
        shortLead="Le journal scellé, le rejeu d'une décision, et la clé qui ouvre tout ça en lecture."
      >
        <p>
          Chaque action conséquente est écrite dans un journal en ajout seul, chaque entrée
          scellée par l'empreinte de la précédente. Cela ne rend pas le fichier
          immodifiable&nbsp;: cela rend une modification <strong>visible</strong>, ce qui est
          la propriété dont un contrôle a réellement besoin.
        </p>
      </PageHead>

      {chain ? (
        <div
          className={`yd-note yd-note--${chain.intact ? "positive" : "negative"}`}
          role="status"
        >
          {chain.message}
        </div>
      ) : null}

      <BentoGrid>
        <BentoCell span={{ base: 1, md: 6, lg: 5 }}>
          <PanelHead icon={DecisionsIcon}>Rejouer une décision</PanelHead>
          {/* A form, so Enter in the field replays too. */}
          <form
            className="yd-invest-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && decisionId) void runReplay();
            }}
          >
            <label className="yd-invest-field">
              <span>Numéro de la décision</span>
              <input className="yd-input yd-num" inputMode="numeric" value={decisionId}
                     onChange={(event) => setDecisionId(event.target.value)}
                     placeholder="142" />
              <small>
                Le numéro figure dans l'adresse d'une décision dépliée, et dans le journal.
              </small>
            </label>
            <div className="yd-invest-actions">
              <button type="submit" className="yd-button yd-button--primary"
                      disabled={busy || !decisionId}>
                {busy ? "Rejeu en cours…" : "Rejouer"}
              </button>
            </div>

            {replayError ? (
              <p className="yd-note yd-note--negative" role="alert">{replayError}</p>
            ) : null}

            {replay ? (
              <div className="yd-detail">
                <p className={`yd-note yd-note--${
                  !replay.inputs_intact ? "negative" : replay.matches ? "positive" : "warning"
                }`}>
                  {replay.verdict}
                </p>
                <div className="yd-detail__section">
                  <h3 className="yd-detail__heading">Empreinte enregistrée</h3>
                  <p className="yd-detail__hash">{replay.inputs_hash_stored}</p>
                  <h3 className="yd-detail__heading">Empreinte recalculée</h3>
                  <p className="yd-detail__hash">{replay.inputs_hash_recomputed}</p>
                </div>
                <div className="yd-scroll-x">
                  <table className="yd-table">
                    <caption className="yd-visually-hidden">
                      Réponses enregistrées et réponses rejouées, question par question
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Question</th>
                        <th scope="col">Enregistré</th>
                        <th scope="col">Rejoué</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(replay.stored_answers).map((key) => {
                        const stored = replay.stored_answers[key];
                        const again = replay.replayed_answers[key];
                        const read = (answer: typeof stored | undefined) =>
                          answer
                            ? answer.choice
                              ?? (answer.score_value !== null && answer.score_value !== undefined
                                ? String(answer.score_value)
                                : answer.probability_bps !== null
                                    && answer.probability_bps !== undefined
                                  ? `${Math.round(answer.probability_bps / 100)} %`
                                  : "—")
                            : "non rejouée";
                        return (
                          <tr key={key}>
                            <th scope="row">{key}</th>
                            <td>{read(stored)}</td>
                            <td>{read(again)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </form>
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 7 }}>
          <PanelHead icon={OversightIcon}
                     subtitle={`${chain?.events ?? 0} ${plural(chain?.events ?? 0, "entrée", "entrées")}, ${chain?.intact ? "chaîne intacte" : "chaîne rompue"}`}>
            Le journal
          </PanelHead>
          <div className="yd-scroll-x">
            <table className="yd-table">
              <caption className="yd-visually-hidden">
                Le journal en ajout seul : rang, événement, auteur et horodatage
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="yd-num">Rang</th>
                  <th scope="col">Événement</th>
                  <th scope="col">Par</th>
                  <th scope="col">Quand</th>
                </tr>
              </thead>
              <tbody>
                {[...(chain?.entries ?? [])].reverse().map((entry) => (
                  <tr key={entry.sequence}>
                    <th scope="row" className="yd-num">{entry.sequence}</th>
                    <td>{labelFor(JOURNAL_KIND_LABELS, entry.kind)}</td>
                    <td>{labelFor(ACTOR_LABELS, entry.actor)}</td>
                    <td>{formatDateTime(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 12 }}>
          <PanelHead icon={OversightIcon}>Faire contrôler le pilote par une autre IA</PanelHead>
          <p className="yd-note">
            La clé d'accès de Réglages ouvre les routes ci-dessous en lecture, plus l'arrêt
            d'urgence. Donnez-la à Claude, ou à n'importe quel programme, et il pourra vérifier
            ce que fait le pilote sans pouvoir le lancer.
          </p>
          <div className="yd-code">{`GET  /api/invest/oversight/contrat    les règles déclarées et ce qu'une clé peut faire
GET  /api/invest/oversight/etat       le mandat, le compte, l'entonnoir, la calibration
GET  /api/invest/oversight/journal    la chaîne et sa vérification (?since=<rang>)
POST /api/invest/oversight/replay/42  rejouer la décision 42
POST /api/invest/oversight/halt       arrêter le pilotage`}</div>
          <p className="yd-note">
            Une clé d'accès <strong>ne peut pas</strong> modifier le mandat, armer l'exécution
            réelle, lancer un tour en mode réel, connecter un courtier, ni relancer le pilotage
            après un arrêt. Un superviseur qui peut arrêter sans pouvoir démarrer est la bonne
            forme&nbsp;: ce qu'il surveille, c'est une machine qui en fait trop, et le remède à
            cela n'est jamais d'en faire davantage.
          </p>
        </BentoCell>
      </BentoGrid>
    </div>
  );
}
