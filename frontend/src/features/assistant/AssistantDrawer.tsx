import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";

import { useAISpotlight } from "../../design/ai/AISpotlight";
import { categoryTarget, targetsMentionedIn, type AiTarget } from "../../design/ai/targets";
import { AssistantIcon, CloseIcon, SearchIcon } from "../../design/icons";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { SIGNATURE_EASE } from "../../design/motion/variants";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { Category, ChatMessage } from "../../lib/types";
import "./AssistantDrawer.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** Openers offered on an empty conversation — the phrasings the parser is
 *  known to understand, so the first question a reader asks is one that
 *  works. */
const OPENERS = [
  "Combien j'ai dépensé en restaurant en mars ?",
  "Quel est mon solde net ce mois-ci ?",
  "Où en sont mes budgets ?",
];

interface AssistantDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The assistant, in a panel that opens over whatever screen the reader is on.
 *
 * The full screen at /assistant is unchanged and still the place to read a
 * conversation; this is the same engine, reachable without leaving the figures
 * being discussed — which is the whole point of the chips below.
 */
export function AssistantDrawer({ open, onClose }: AssistantDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.querySelector("input")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  // The history and the category list are fetched once the panel is first
  // opened, not on every mount of the shell: an assistant nobody opened must
  // not cost two requests on every screen.
  useEffect(() => {
    if (!open || messages.length > 0) return;
    let cancelled = false;
    void Promise.allSettled([api.get<ChatMessage[]>("/chat"), api.get<Category[]>("/categories")])
      .then(([history, cats]) => {
        if (cancelled) return;
        if (history.status === "fulfilled") setMessages(history.value);
        if (cats.status === "fulfilled") setCategories(cats.value);
      });
    return () => {
      cancelled = true;
    };
  }, [open, messages.length]);

  // The newest exchange, every time one lands.
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages.length, reduced]);

  async function ask(text: string) {
    const asked = text.trim();
    if (asked === "" || asking) return;
    setAsking(true);
    setError(null);
    try {
      const answered = await api.post<ChatMessage>("/chat", { text: asked });
      setMessages((current) => [...current, answered]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setAsking(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  // One target per budget category the account actually has, so an answer
  // naming "Courses" can point at that row and not merely at the screen.
  const extraTargets = categories.map((category) => categoryTarget(category.name));

  const body = (
    <div
      className="yd-assistant-drawer__panel"
      role="dialog"
      aria-modal="false"
      aria-label="Assistant"
      ref={panel}
    >
      <div className="yd-assistant-drawer__head">
        <span className="yd-assistant-drawer__mark" aria-hidden="true">
          <AssistantIcon />
        </span>
        <div className="yd-assistant-drawer__heading">
          <h2>Assistant</h2>
          <p>Calculé sur vos propres relevés. Aucune IA n'intervient.</p>
        </div>
        <button
          type="button"
          className="yd-assistant-drawer__close"
          onClick={onClose}
          aria-label="Fermer l'assistant"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="yd-assistant-drawer__thread" ref={thread}>
        {messages.length === 0 ? (
          <div className="yd-assistant-drawer__openers">
            <p>Posez une question sur vos opérations. Par exemple&nbsp;:</p>
            {OPENERS.map((opener) => (
              <button
                key={opener}
                type="button"
                className="yd-assistant-drawer__opener"
                onClick={() => void ask(opener)}
              >
                <SearchIcon />
                {opener}
              </button>
            ))}
          </div>
        ) : (
          messages.map((message) => (
            <Exchange key={message.id} message={message} extraTargets={extraTargets} />
          ))
        )}

        {error !== null ? (
          <p role="alert" className="yd-assistant-drawer__error">
            {error}
          </p>
        ) : null}
      </div>

      <form className="yd-assistant-drawer__ask" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="yd-assistant-drawer-question">
          Votre question
        </label>
        <input
          id="yd-assistant-drawer-question"
          type="text"
          value={question}
          placeholder="Combien j'ai dépensé en restaurant en mars ?"
          onChange={(event) => setQuestion(event.target.value)}
          disabled={asking}
        />
        <button type="submit" disabled={asking || question.trim() === ""}>
          {asking ? "…" : "Demander"}
        </button>
      </form>
    </div>
  );

  if (reduced) {
    return open ? <div className="yd-assistant-drawer">{body}</div> : null;
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="yd-assistant-drawer"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.28, ease: SIGNATURE_EASE }}
        >
          {body}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * One question and its answer, with a chip for every part of the interface the
 * answer names.
 *
 * A chip is offered only when its element is really in the document, or when
 * the target lives on another screen and can be navigated to — see
 * `design/ai/targets.ts` for why nothing is ever guessed here.
 */
function Exchange({ message, extraTargets }: { message: ChatMessage; extraTargets: AiTarget[] }) {
  const answer = message.answer;
  const targets = targetsMentionedIn(`${message.text} ${answer.text}`, extraTargets);

  return (
    <div className="yd-exchange">
      <p className="yd-exchange__question">{message.text}</p>

      <div className="yd-exchange__answer">
        <p className={answer.is_refusal ? "yd-exchange__refusal" : undefined}>{answer.text}</p>

        {answer.amount_cents !== null ? (
          <p className="yd-exchange__amount yd-num">{formatCents(answer.amount_cents)}</p>
        ) : null}

        {/* Design §8.1: the executed query travels beside every figure, so the
            answer can be checked against what was actually computed. */}
        {answer.query_description !== null ? (
          <p className="yd-exchange__query">{answer.query_description}</p>
        ) : null}

        {targets.length > 0 ? (
          <p className="yd-exchange__chips">
            <span className="sr-only">Éléments de l'interface cités dans cette réponse :</span>
            {targets.map((target) => (
              <SpotlightChip key={target.id} target={target} />
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A word in the answer, made pointable.
 *
 * Hover lights the thing; a click lights it, holds it, and scrolls to it. When
 * it lives on another screen the chip says so and navigates there first — a
 * chip that silently did nothing because the card is three routes away is the
 * failure this whole feature exists to avoid.
 */
function SpotlightChip({ target }: { target: AiTarget }) {
  const { spotlight, preview, exists } = useAISpotlight();
  const navigate = useNavigate();
  const location = useLocation();
  const here = exists(target.id);
  const sameRoute = location.pathname === target.route;

  return (
    <button
      type="button"
      className="yd-exchange__chip"
      data-elsewhere={here ? undefined : ""}
      onMouseEnter={() => (here ? preview(target.id) : undefined)}
      onMouseLeave={() => (here ? preview(null) : undefined)}
      onFocus={() => (here ? preview(target.id) : undefined)}
      onBlur={() => (here ? preview(null) : undefined)}
      onClick={() => {
        if (here) {
          spotlight(target.id);
          return;
        }
        if (!sameRoute) navigate(target.route);
        // After the route has rendered. The target may still be loading its
        // data, in which case nothing is lit and nothing is broken — the
        // spotlight simply finds no element and scrolls nowhere.
        window.setTimeout(() => spotlight(target.id), 400);
      }}
    >
      {target.label}
      {here ? null : <span className="yd-exchange__chip-note">voir</span>}
    </button>
  );
}
