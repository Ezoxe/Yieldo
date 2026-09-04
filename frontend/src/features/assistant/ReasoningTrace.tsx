import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";

import { CheckIcon, ChevronIcon } from "../../design/icons";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { SIGNATURE_EASE } from "../../design/motion/variants";
import type { ChatStep } from "../../lib/types";
import "./ReasoningTrace.css";

/**
 * What the assistant actually ran, shown as it comes back.
 *
 * The honest shape of this feature matters more than the animation on it.
 * Yieldo's assistant has no model and no tool calls to narrate: it parses a
 * French sentence, reads the ledger, and calls engines. So the panel does not
 * *simulate* a train of thought — every line comes from `answer.steps`, which
 * `engines/answer.trace_query` produced for this question, with this account's
 * own counts in it.
 *
 * What IS presentation is the reveal: the steps stage in one after another so
 * the sequence reads as a sequence rather than as a block that appeared. No
 * duration is ever printed beside a step, precisely because the stagger is a
 * rhythm and not a measurement — a "1,2 s" next to "Lecture du relevé" would
 * be a number nobody timed.
 */

/** Milliseconds between two rows arriving. Fast enough not to be a wait, slow
 *  enough that four steps read as four. */
const STEP_STAGGER = 0.09;

interface ReasoningTraceProps {
  steps: ChatStep[];
  /**
   * True for an answer that arrived in this session. History rows render
   * instantly and closed: replaying four staggered reveals on every page load
   * of a fifty-message conversation would be motion for its own sake.
   */
  fresh?: boolean;
}

/** The screens named in a trace, deduplicated, in order of first mention. */
export function screensTouched(steps: ChatStep[]): string[] {
  const seen: string[] = [];
  for (const step of steps) {
    if (step.screen !== null && !seen.includes(step.screen)) seen.push(step.screen);
  }
  return seen;
}

/** The French name of a route, for the chip that navigates to it. Only routes
 *  a trace can actually name are listed; anything else falls back to the path
 *  itself rather than to an invented label. */
const SCREEN_NAMES: Record<string, string> = {
  "/": "Vue d'ensemble",
  "/transactions": "Transactions",
  "/budgets": "Budgets",
  "/recurrences": "Récurrences",
  "/tresorerie": "Trésorerie",
  "/analyse": "Analyse",
  "/dettes": "Dettes",
  "/objectifs": "Objectifs",
  "/patrimoine": "Patrimoine",
  "/projection": "Projection",
  "/faisabilite": "Faisabilité",
  "/suivi": "Suivi",
};

export function screenName(route: string): string {
  return SCREEN_NAMES[route] ?? route;
}

export function ReasoningTrace({ steps, fresh = false }: ReasoningTraceProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(fresh);

  if (steps.length === 0) return null;

  const screens = screensTouched(steps);

  return (
    <div className="yd-trace" data-fresh={fresh ? "" : undefined}>
      <button
        type="button"
        className="yd-trace__toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="yd-trace__toggle-mark" aria-hidden="true">
          <ChevronIcon />
        </span>
        <span className="yd-trace__toggle-text">
          Raisonnement
          <span className="yd-trace__count yd-num">{steps.length}</span>
        </span>
        <span className="yd-trace__toggle-hint">
          {screens.length === 0
            ? "aucun écran interrogé"
            : `${screens.length} écran${screens.length > 1 ? "s" : ""} interrogé${screens.length > 1 ? "s" : ""}`}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.ol
            className="yd-trace__steps"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={reduced ? undefined : { height: "auto", opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: SIGNATURE_EASE }}
          >
            {steps.map((step, index) => (
              <TraceStep
                key={`${step.tool}-${index}`}
                step={step}
                // Only a fresh answer stages in. Re-opening the panel on an old
                // exchange shows it at once, because nothing is happening then.
                delay={fresh && !reduced ? index * STEP_STAGGER : 0}
                animate={fresh && !reduced}
              />
            ))}
          </motion.ol>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TraceStep({
  step,
  delay,
  animate,
}: {
  step: ChatStep;
  delay: number;
  animate: boolean;
}) {
  return (
    <motion.li
      className="yd-trace__step"
      initial={animate ? { opacity: 0, x: -10 } : false}
      animate={animate ? { opacity: 1, x: 0 } : undefined}
      transition={{ duration: 0.3, ease: SIGNATURE_EASE, delay }}
    >
      {/* The rail: a dot per step, joined by the line drawn in CSS. It is what
          makes four rows read as one sequence instead of four bullets. */}
      <span className="yd-trace__dot" aria-hidden="true">
        <CheckIcon />
      </span>

      <div className="yd-trace__body">
        <p className="yd-trace__label">
          {step.label}
          <code className="yd-trace__tool">{step.tool}</code>
        </p>
        <p className="yd-trace__source">{step.source}</p>
        {step.screen !== null ? (
          <Link className="yd-trace__screen" to={step.screen}>
            {screenName(step.screen)}
          </Link>
        ) : null}
      </div>
    </motion.li>
  );
}

/**
 * The in-flight state: one request is out, and that is all that is known.
 *
 * Deliberately NOT a fake step list ticking through "Lecture du relevé…",
 * "Calcul…": the front end cannot see the backend's phases, and inventing
 * them would put a progress report on screen that nothing measured. What it
 * shows instead is true — a query is running on the reader's own ledger —
 * animated so the wait has a pulse rather than a spinner.
 */
export function ThinkingIndicator() {
  const reduced = useReducedMotion();

  return (
    <div className="yd-thinking" role="status" aria-live="polite">
      <span className="yd-thinking__rail" aria-hidden="true">
        <span className="yd-thinking__pulse" data-still={reduced ? "" : undefined} />
      </span>
      <div className="yd-thinking__body">
        <p className="yd-thinking__label">
          Exécution de la requête sur vos relevés
          <span className="yd-thinking__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </p>
        <p className="yd-thinking__note">
          Le détail de ce qui a été exécuté s'affichera avec la réponse.
        </p>
      </div>
    </div>
  );
}
