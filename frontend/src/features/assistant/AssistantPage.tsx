import { motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AnswerChart } from "../../charts/AnswerChart";
import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { EmptyState } from "../../design/EmptyState";
import { AssistantIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { api } from "../../lib/api";
import { messageFor } from "../../lib/refusal";
import type { ChatMessage } from "../../lib/types";
import { ReasoningTrace, ThinkingIndicator } from "./ReasoningTrace";
import "./AssistantPage.css";

const SPAN = {
  full: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

/** The ten phrasings the parser understands, offered before anything has been
 *  asked. `engines/intent.py` owns the list and sends it back with every
 *  unrecognised question; this is the same set, for the state where nothing
 *  has been asked yet and there is no answer to carry it. */
const OPENING_FORMULATIONS = [
  "Combien j'ai dépensé en restaurant en mars ?",
  "Quelle est ma moyenne mensuelle de dépenses depuis janvier ?",
  "Ai-je dépensé plus ce mois-ci que le mois dernier ?",
  "Est-ce que mon abonnement Netflix a augmenté ?",
  "Combien me coûtent mes abonnements ?",
  "Puis-je m'acheter une voiture à 20 000 € dans 12 mois ?",
  "Si j'épargne 200 € par mois pendant 24 mois, combien aurai-je ?",
  "Où en est mon objectif Vacances ?",
  "Montre-moi mes achats chez Darty en mars.",
  "Quelle sera la valeur de mon patrimoine dans 5 ans ?",
];

/**
 * The clickable phrasings. Clicking one ASKS it, verbatim — it does not merely
 * paste it into the field. A suggestion the reader still has to submit is a
 * hint; one that answers is the parser teaching itself what it accepts, which
 * is the whole reason an unrecognised question carries this list at all.
 */
function Suggestions({
  formulations,
  onPick,
  disabled,
}: {
  formulations: string[];
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <ul className="yd-suggestions">
      {formulations.map((formulation) => (
        <li key={formulation}>
          <button
            type="button"
            className="yd-suggestions__item"
            data-testid={`yd-suggestion-${formulation}`}
            disabled={disabled}
            onClick={() => onPick(formulation)}
          >
            {formulation}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One question and the answer it produced.
 *
 * Three registers, and they are three different things on the rendered page:
 *
 * * **the executed query** — design §8.1's "la requête exécutée, en clair".
 *   Printed on every recognised answer, refusal included, because a refused
 *   answer was still computed FROM something and the reader has to be able to
 *   check what.
 * * **a refusal** — the engine's own sentence, on the warning rule, verbatim.
 *   Never softened, never rephrased, never wrapped in reassurance: it already
 *   names its own cause and its own remedy, and restating it is this project's
 *   most repeated defect.
 * * **an unrecognised question** — not an error. The sentence, then the ten
 *   phrasings that do work, each of them a button.
 */
function Exchange({
  message,
  onPick,
  busy,
  fresh,
}: {
  message: ChatMessage;
  onPick: (text: string) => void;
  busy: boolean;
  /** Answered in this session, so its trace stages in rather than appearing. */
  fresh: boolean;
}) {
  const { answer } = message;

  return (
    <li className="yd-exchange" data-testid={`yd-exchange-${message.id}`}>
      <p className="yd-exchange__question">{message.text}</p>

      {answer.query_description !== null ? (
        <p className="yd-exchange__query" data-testid={`yd-exchange-query-${message.id}`}>
          <span className="yd-exchange__query-label">Requête exécutée</span>
          {answer.query_description}
        </p>
      ) : null}

      {!answer.recognised ? (
        <div
          className="yd-exchange__unrecognised"
          data-testid={`yd-exchange-unrecognised-${message.id}`}
        >
          <p className="yd-exchange__unrecognised-text">{answer.text}</p>
          <Suggestions
            formulations={answer.supported_formulations ?? []}
            onPick={onPick}
            disabled={busy}
          />
        </div>
      ) : answer.is_refusal ? (
        <p className="yd-exchange__refusal" data-testid={`yd-exchange-refusal-${message.id}`}>
          {answer.text}
        </p>
      ) : (
        <p className="yd-exchange__answer" data-testid={`yd-exchange-answer-${message.id}`}>
          {answer.text}
        </p>
      )}

      {answer.chart !== null ? (
        <div className="yd-exchange__chart" data-testid={`yd-exchange-chart-${message.id}`}>
          <p className="yd-exchange__chart-title">{answer.chart.title}</p>
          <AnswerChart chart={answer.chart} />
        </div>
      ) : null}

      {/* Design §8.1 asks for the executed query beside every figure; this is
          the same promise one level down — the engines that ran, the ledger
          they read, and the screens showing the same data. */}
      <ReasoningTrace steps={answer.steps} fresh={fresh} />
    </li>
  );
}

/**
 * `/assistant` — the deterministic chat. Design §8.1.
 *
 * **Nothing on this screen is generated.** Every figure comes out of an engine,
 * and the query that produced it is printed beside it in clear French so it can
 * be checked. There is no model here, and none is needed.
 *
 * **The refused screen is the primary screen.** On the operator's own ledger —
 * no goal, no position, no API key — most questions come back as a refusal,
 * each naming its own cause and its own remedy. Those are not errors and are
 * never dressed as ones: an `role="alert"` on this page means the round trip
 * itself failed, and nothing else.
 */
export function AssistantPage() {
  const reduced = useReducedMotion();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAsking, setIsAsking] = useState(false);
  // Answered in this session. Only these stage their trace in; a history of
  // fifty exchanges replaying its reveals on every load would be noise.
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const history = await api.get<ChatMessage[]>("/chat");
        if (!cancelled) setMessages(history);
      } catch (err) {
        if (!cancelled) setError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function askQuestion(text: string) {
    const question = text.trim();
    if (question.length === 0) {
      // Refused here rather than at the API: an empty box is not a question,
      // and a round trip that can only come back "422" teaches nobody anything.
      setError("Écrivez une question avant de la poser.");
      return;
    }
    setIsAsking(true);
    setError(null);
    try {
      const answered = await api.post<ChatMessage>("/chat", { text: question });
      setMessages((current) => [...current, answered]);
      setFresh((current) => new Set(current).add(answered.id));
      setDraft("");
    } catch (err) {
      // A failure of the ROUND TRIP, never a refusal: an engine declining to
      // compute arrives on a 200 as content, and is rendered by `Exchange`.
      setError(messageFor(err));
    } finally {
      setIsAsking(false);
      field.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void askQuestion(draft);
  }

  async function clearConversation() {
    setError(null);
    try {
      await api.delete<void>("/chat");
      setMessages([]);
    } catch (err) {
      setError(messageFor(err));
    }
  }

  return (
    <section className="yd-assistant">
      <PageHead icon={AssistantIcon} title="Assistant" className="yd-assistant__header">

        <p className="yd-assistant__lead">
          Posez une question en français sur vos propres relevés. Chaque réponse est calculée par
          les moteurs de Yieldo et affiche <strong>la requête exécutée, en clair</strong>, pour que
          vous puissiez vérifier ce qui a été compté. Aucune intelligence artificielle n'intervient
          ici&nbsp;: quand une question n'est pas comprise, Yieldo le dit et propose les
          formulations qu'il sait traiter, plutôt que d'inventer une réponse plausible.
        </p>
      </PageHead>

      {error !== null ? (
        <p role="alert" className="yd-assistant__alert" data-testid="yd-assistant-error">
          {error}
        </p>
      ) : null}

      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <form className="yd-ask" onSubmit={onSubmit}>
            <label className="yd-ask__label" htmlFor="yd-ask-field">
              Votre question
            </label>
            <div className="yd-ask__row">
              <input
                id="yd-ask-field"
                ref={field}
                className="yd-ask__field"
                type="text"
                maxLength={500}
                autoComplete="off"
                value={draft}
                placeholder="Combien j'ai dépensé en restaurant en mars ?"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" className="yd-ask__submit" disabled={isAsking}>
                {isAsking ? "Calcul…" : "Demander"}
              </button>
            </div>
            <p className="yd-ask__hint">
              Yieldo répond sur la période, la catégorie et le montant que votre phrase désigne. Il
              ne devine jamais&nbsp;: une question hors de sa portée reçoit une liste de
              formulations, pas une approximation.
            </p>
          </form>
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <div className="yd-assistant__conversation-head">
            <PanelHead icon={AssistantIcon}>Conversation</PanelHead>
            {messages.length > 0 ? (
              <button
                type="button"
                className="yd-assistant__clear"
                onClick={() => void clearConversation()}
              >
                Effacer la conversation
              </button>
            ) : null}
          </div>

          {isLoading ? (
            <div role="status" aria-busy="true" aria-label="Chargement de la conversation">
              <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
              <div className="yd-skeleton yd-skeleton--patrimoine-card" aria-hidden="true" />
            </div>
          ) : messages.length === 0 && !isAsking ? (
            // `&& !isAsking`: the very first question of a conversation must
            // show the wait too. Without it the empty state stayed on screen
            // for the whole round trip and nothing said anything was
            // happening — seen in a browser on a fresh account.
            <div data-testid="yd-assistant-empty">
              <EmptyState
                title="Aucune question posée pour l'instant."
                detail="Voici les dix formulations que Yieldo sait traiter aujourd'hui. Cliquez-en une pour la poser telle quelle."
              />
              <Suggestions
                formulations={OPENING_FORMULATIONS}
                onPick={(text) => void askQuestion(text)}
                disabled={isAsking}
              />
            </div>
          ) : (
            <ul className="yd-assistant__exchanges">
              {messages.map((message) => (
                <Exchange
                  key={message.id}
                  message={message}
                  busy={isAsking}
                  fresh={fresh.has(message.id)}
                  onPick={(text) => void askQuestion(text)}
                />
              ))}
              {/* The wait, said once, at the end of the conversation where the
                  answer is about to land. */}
              {isAsking ? (
                <li className="yd-assistant__waiting">
                  <ThinkingIndicator />
                </li>
              ) : null}
            </ul>
          )}
        </BentoCell>
      </BentoGrid>
    </section>
  );
}
