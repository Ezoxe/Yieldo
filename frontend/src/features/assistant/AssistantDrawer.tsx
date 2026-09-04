import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";

import { useAISpotlight } from "../../design/ai/AISpotlight";
import { categoryTarget, targetsMentionedIn, type AiTarget } from "../../design/ai/targets";
import { AssistantIcon, CloseIcon, ListIcon, PlusIcon, SearchIcon, TrashIcon } from "../../design/icons";
import { IconBadge } from "../../design/icons/IconBadge";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { SIGNATURE_EASE } from "../../design/motion/variants";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { Category, ChatMessage, Conversation } from "../../lib/types";
import { ReasoningTrace, ThinkingIndicator } from "./ReasoningTrace";
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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // The thread being written into. `null` is a NEW conversation that has no
  // number yet: the server allocates one when the first question lands, which
  // is also why an empty thread never appears in the list — it does not exist.
  const [current, setCurrent] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  // The ids answered in THIS session. Only they play the staggered reveal;
  // history arrives already computed and replaying it would be motion for
  // its own sake. A Set, because the check is per row on every render.
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
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

  // The thread list and the category list are fetched once the panel is first
  // opened, not on every mount of the shell: an assistant nobody opened must
  // not cost two requests on every screen.
  //
  // The most recent thread is the one that opens, and its messages are fetched
  // with it. Opening onto a blank "new conversation" every time would make the
  // history a place you have to go looking for rather than where you already
  // are.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    void Promise.allSettled([
      api.get<Conversation[]>("/chat/conversations"),
      api.get<Category[]>("/categories"),
    ]).then(async ([threads, cats]) => {
      if (cancelled) return;
      if (cats.status === "fulfilled") setCategories(cats.value);
      if (threads.status !== "fulfilled") return;
      setConversations(threads.value);
      setLoaded(true);
      const newest = threads.value[0];
      if (newest === undefined) return;
      setCurrent(newest.id);
      const rows = await api.get<ChatMessage[]>(`/chat?conversation_id=${newest.id}`);
      if (!cancelled) setMessages(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

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
      const answered = await api.post<ChatMessage>("/chat", {
        text: asked,
        // null opens a new thread; the server hands back the number it chose.
        conversation_id: current,
      });
      setMessages((rows) => [...rows, answered]);
      setFresh((ids) => new Set(ids).add(answered.id));
      setCurrent(answered.conversation_id);
      setQuestion("");
      // The list is re-read rather than patched: its titles, counts and order
      // are all derived server-side, and a client that recomputed them here
      // would be a second implementation free to disagree.
      setConversations(await api.get<Conversation[]>("/chat/conversations"));
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

  /** A blank thread. Nothing is written until the first question lands. */
  function startNew() {
    setMessages([]);
    setCurrent(null);
    setQuestion("");
    setError(null);
    setHistoryOpen(false);
    panel.current?.querySelector("input")?.focus();
  }

  async function openConversation(id: number) {
    setHistoryOpen(false);
    setError(null);
    setCurrent(id);
    try {
      setMessages(await api.get<ChatMessage[]>(`/chat?conversation_id=${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    }
  }

  async function removeConversation(id: number) {
    setError(null);
    try {
      await api.delete(`/chat?conversation_id=${id}`);
      const remaining = await api.get<Conversation[]>("/chat/conversations");
      setConversations(remaining);
      // Deleting the thread on screen leaves a blank one, never someone else's
      // messages under the heading you were just reading.
      if (id === current) startNew();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    }
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
        {/* The app's own badge, not a second drawing of one. The local copy
            had grown a radial gradient and a coloured drop shadow — both
            forbidden by CLAUDE.md, and both the reason this mark looked like a
            rendering fault beside every other panel head in the app. */}
        <IconBadge icon={AssistantIcon} />
        <div className="yd-assistant-drawer__heading">
          <h2>Assistant</h2>
          <p>Calculé sur vos propres relevés. Aucune IA n'intervient.</p>
        </div>
        <button
          type="button"
          className="yd-assistant-drawer__action"
          onClick={startNew}
          aria-label="Nouvelle conversation"
          title="Nouvelle conversation"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className="yd-assistant-drawer__action"
          onClick={() => setHistoryOpen((shown) => !shown)}
          aria-expanded={historyOpen}
          aria-label="Conversations"
          title="Conversations"
        >
          <ListIcon />
        </button>
        <button
          type="button"
          className="yd-assistant-drawer__close"
          onClick={onClose}
          aria-label="Fermer l'assistant"
        >
          <CloseIcon />
        </button>
      </div>

      {historyOpen ? (
        <div className="yd-convos">
          {conversations.length === 0 ? (
            <p className="yd-convos__empty">
              Aucune conversation enregistrée. Posez une question&nbsp;: elle en ouvrira une.
            </p>
          ) : (
            <ul className="yd-convos__list">
              {conversations.map((thread) => (
                <li key={thread.id} className="yd-convos__item">
                  <button
                    type="button"
                    className="yd-convos__open"
                    data-current={thread.id === current ? "" : undefined}
                    onClick={() => void openConversation(thread.id)}
                  >
                    <span className="yd-convos__title">{thread.title}</span>
                    <span className="yd-convos__meta">
                      {conversationMeta(thread)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="yd-convos__delete"
                    onClick={() => void removeConversation(thread.id)}
                    aria-label={`Supprimer la conversation « ${thread.title} »`}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

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
            <Exchange
              key={message.id}
              message={message}
              extraTargets={extraTargets}
              fresh={fresh.has(message.id)}
            />
          ))
        )}

        {/* The question is already on screen above; this is the only thing the
            front end knows while the answer is being computed. */}
        {asking ? <ThinkingIndicator /> : null}

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
 * "3 questions · 4 septembre" — how long the thread is and when it last moved.
 *
 * `last_at`, not `started_at`: the list is ordered on the most recent question,
 * so a date that named the first one would put the rows in an order the dates
 * appear to contradict.
 */
export function conversationMeta(thread: Conversation): string {
  const count = `${thread.message_count} question${thread.message_count > 1 ? "s" : ""}`;
  const when = new Date(thread.last_at).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
  });
  return `${count} · ${when}`;
}

/**
 * One question and its answer, with a chip for every part of the interface the
 * answer names.
 *
 * A chip is offered only when its element is really in the document, or when
 * the target lives on another screen and can be navigated to — see
 * `design/ai/targets.ts` for why nothing is ever guessed here.
 */
function Exchange({
  message,
  extraTargets,
  fresh,
}: {
  message: ChatMessage;
  extraTargets: AiTarget[];
  fresh: boolean;
}) {
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

        {/* What was actually run to get there — the engines, the ledger it
            read, and the screens showing the same data. */}
        <ReasoningTrace steps={answer.steps} fresh={fresh} />

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
