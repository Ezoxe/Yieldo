import { useCallback, useEffect, useState, type FormEvent } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { EmptyState } from "../../design/EmptyState";
import { AssistantIcon, CheckIcon, CloseIcon, ProposalsIcon, TrashIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { AgentRun, Proposal, ProposalKind, ProposalState } from "../../lib/types";
import { AgentTrace } from "./AgentTrace";
import { useProposalCount } from "./useProposalCount";
import "./ProposalsPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

const SPAN = {
  ask: { base: 1, md: 6, lg: 12 },
  run: { base: 1, md: 6, lg: 12 },
  queue: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  recategorize: "Reclassement d'opérations",
  category_rule: "Règle de catégorisation",
  plan_line: "Ligne de plan prévisionnel",
  alert_note: "Constat",
  category_budget: "Budget mensuel",
  goal: "Objectif d'épargne",
  debt_strategy: "Remboursement de dette",
};

const STATE_LABELS: Record<ProposalState, string> = {
  pending: "En attente",
  applied: "Appliquée",
  refused: "Refusée",
};

/**
 * The queue the agent writes into, and the one place a change it wants
 * actually happens.
 *
 * Everything on this screen is a request. Nothing in `agent_proposals` has
 * taken effect, and the only code in the application that turns one of these
 * rows into data runs when the button on this card is pressed. That is why the
 * screen shows the payload and the evidence rather than a tidy sentence: a
 * reviewer approving a change is entitled to see exactly what it is.
 *
 * A refused proposal keeps its row. The same suggestion coming back a third
 * time is only visible as such if the first two are still here.
 */
export function ProposalsPage() {
  const refreshCount = useProposalCount((state) => state.refresh);

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [queue, history] = await Promise.all([
        api.get<Proposal[]>("/agent/proposals"),
        api.get<AgentRun[]>("/agent/runs", { limit: 5 }),
      ]);
      setProposals(queue);
      setRuns(history);
    } catch (err) {
      setLoadError(messageFor(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text === "") {
      setAskError("Écrivez une question avant de la poser.");
      return;
    }
    setAsking(true);
    setAskError(null);
    try {
      const run = await api.post<AgentRun>("/agent/run", { question: text });
      setRuns((current) => [run, ...current].slice(0, 5));
      setQuestion("");
      await load();
      await refreshCount();
    } catch (err) {
      setAskError(messageFor(err));
    } finally {
      setAsking(false);
    }
  }

  async function decide(proposal: Proposal, action: "apply" | "refuse") {
    setDeciding(proposal.id);
    setLoadError(null);
    try {
      const updated = await api.post<Proposal>(
        `/agent/proposals/${proposal.id}/${action}`,
        action === "refuse" ? { note: null } : undefined,
      );
      setProposals((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      await refreshCount();
    } catch (err) {
      setLoadError(messageFor(err));
    } finally {
      setDeciding(null);
    }
  }

  async function forget(proposal: Proposal) {
    setDeciding(proposal.id);
    try {
      await api.delete(`/agent/proposals/${proposal.id}`);
      setProposals((current) => current.filter((item) => item.id !== proposal.id));
    } catch (err) {
      setLoadError(messageFor(err));
    } finally {
      setDeciding(null);
    }
  }

  const pending = proposals.filter((item) => item.state === "pending");
  const decided = proposals.filter((item) => item.state !== "pending");
  const lastRun = runs[0] ?? null;

  return (
    <section className="yd-proposals">
      <PageHead icon={ProposalsIcon} title="Propositions">
        <p>
          Ce que l'IA voudrait changer, et qui n'a pas eu lieu. Rien ici n'est appliqué tant que
          vous ne l'avez pas validé, ligne par ligne — c'est vous qui décidez, toujours.
        </p>
      </PageHead>

      {loadError !== null ? (
        <p className="yd-proposals__alert" role="alert">
          {loadError}
        </p>
      ) : null}

      <BentoGrid>
        <BentoCell span={SPAN.ask}>
          <PanelHead icon={AssistantIcon}>Demander une analyse</PanelHead>
          <form className="yd-proposals__ask" onSubmit={ask}>
            <label htmlFor="yd-proposals-question">Votre demande</label>
            <textarea
              id="yd-proposals-question"
              rows={3}
              placeholder="Repère mes opérations non catégorisées de mars et propose un classement."
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={asking}
            />
            <p className="yd-proposals__note">
              L'IA lit vos données par elle-même, étape par étape, et dépose ses conclusions ici.
              Elle ne modifie rien : elle propose. Le contenu de vos relevés est traité comme une
              donnée, jamais comme une consigne.
            </p>
            {askError !== null ? (
              <p className="yd-proposals__error" role="alert">
                {askError}
              </p>
            ) : null}
            <div className="yd-proposals__ask-actions">
              <button type="submit" className="yd-proposals__send" disabled={asking}>
                {asking ? "Analyse en cours…" : "Lancer l'analyse"}
              </button>
              {asking ? (
                /* What the front end can actually see: one request is running.
                   Never a phase-by-phase progress report through steps it has
                   no way to observe — the trace below is written from the run
                   itself, once it comes back. */
                <span className="yd-proposals__running" role="status">
                  Une requête est en cours.
                </span>
              ) : null}
            </div>
          </form>
        </BentoCell>

        {lastRun !== null ? (
          <BentoCell span={SPAN.run}>
            <PanelHead
              icon={AssistantIcon}
              subtitle={`${lastRun.steps_used} ${plural(lastRun.steps_used, "étape", "étapes")}`}
            >
              Dernière analyse
            </PanelHead>
            <p className="yd-proposals__question">« {lastRun.question} »</p>
            {lastRun.answer !== null ? (
              <p className="yd-proposals__answer">{lastRun.answer}</p>
            ) : null}
            {lastRun.notice !== null ? (
              <p className="yd-proposals__notice" role="status">
                {lastRun.notice}
              </p>
            ) : null}
            <AgentTrace steps={lastRun.steps} />
          </BentoCell>
        ) : null}

        <BentoCell span={SPAN.queue}>
          <PanelHead
            icon={ProposalsIcon}
            subtitle={
              pending.length > 0
                ? `${pending.length} ${plural(pending.length, "en attente", "en attente")}`
                : undefined
            }
          >
            À valider
          </PanelHead>

          {isLoading ? (
            <p className="yd-proposals__waiting" role="status">
              Chargement…
            </p>
          ) : pending.length === 0 ? (
            <EmptyState
              title="Rien à valider"
              detail="L'IA n'a rien proposé pour l'instant. Posez-lui une question ci-dessus : ce qu'elle voudra changer atterrira ici, et attendra votre accord."
            />
          ) : (
            <ul className="yd-proposals__list">
              {pending.map((proposal) => (
                <li key={proposal.id} className="yd-proposals__card">
                  <div className="yd-proposals__card-head">
                    <span className="yd-proposals__kind">
                      {PROPOSAL_KIND_LABELS[proposal.kind] ?? proposal.kind}
                    </span>
                    <span className="yd-proposals__state">{STATE_LABELS[proposal.state]}</span>
                  </div>
                  <p className="yd-proposals__summary">{proposal.summary}</p>
                  {proposal.evidence.trim() !== "" ? (
                    <p className="yd-proposals__evidence">
                      <span>Chiffre calculé par Yieldo :</span> {proposal.evidence}
                    </p>
                  ) : (
                    /* The model wrote a suggestion with no engine figure behind
                       it. Not hidden, not silently accepted: named. */
                    <p className="yd-proposals__evidence yd-proposals__evidence--missing">
                      Aucun chiffre de Yieldo ne justifie cette proposition. Vérifiez-la vous-même
                      avant de la valider.
                    </p>
                  )}
                  <details className="yd-proposals__payload">
                    <summary>Ce qui serait modifié, exactement</summary>
                    <pre>{JSON.stringify(proposal.payload, null, 2)}</pre>
                  </details>
                  <div className="yd-proposals__actions">
                    <button
                      type="button"
                      className="yd-proposals__apply"
                      disabled={deciding === proposal.id}
                      onClick={() => void decide(proposal, "apply")}
                    >
                      <CheckIcon />
                      Valider
                    </button>
                    <button
                      type="button"
                      className="yd-proposals__refuse"
                      disabled={deciding === proposal.id}
                      onClick={() => void decide(proposal, "refuse")}
                    >
                      <CloseIcon />
                      Refuser
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {decided.length > 0 ? (
            <details className="yd-proposals__history">
              <summary>
                {decided.length} {plural(decided.length, "décision passée", "décisions passées")}
              </summary>
              <ul className="yd-proposals__list">
                {decided.map((proposal) => (
                  <li key={proposal.id} className="yd-proposals__card yd-proposals__card--decided">
                    <div className="yd-proposals__card-head">
                      <span className="yd-proposals__kind">
                        {PROPOSAL_KIND_LABELS[proposal.kind] ?? proposal.kind}
                      </span>
                      <span
                        className={`yd-proposals__state yd-proposals__state--${proposal.state}`}
                      >
                        {STATE_LABELS[proposal.state]}
                      </span>
                    </div>
                    <p className="yd-proposals__summary">{proposal.summary}</p>
                    {proposal.applied_summary !== null ? (
                      <p className="yd-proposals__applied">{proposal.applied_summary}</p>
                    ) : null}
                    {proposal.decision_note !== null ? (
                      <p className="yd-proposals__applied">Motif : {proposal.decision_note}</p>
                    ) : null}
                    <div className="yd-proposals__actions">
                      <button
                        type="button"
                        className="yd-proposals__forget"
                        disabled={deciding === proposal.id}
                        onClick={() => void forget(proposal)}
                        aria-label={`Retirer « ${proposal.summary} » de la liste`}
                      >
                        <TrashIcon />
                        Retirer de la liste
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </BentoCell>
      </BentoGrid>
    </section>
  );
}
