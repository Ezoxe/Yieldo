import { motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { api } from "../../lib/api";
import { messageFor } from "../../lib/refusal";
import type { Category, Engagement } from "../../lib/types";
import { ChallengeList } from "./ChallengeList";
import { HealthComponentList, HealthHistoryPanel, HealthScoreSummary } from "./HealthPanel";
import { MilestonesPanel } from "./MilestonesPanel";
import { StreakPanel } from "./StreakPanel";
import "./SuiviPage.css";

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the same cells at the same spans and nothing
 * moves when the data arrives.
 *
 * The streak spans the full width at every breakpoint: it carries a strip of
 * one cell per observed month — twenty-one of them on the operator's own
 * ledger — and a narrow column would wrap it into an unreadable block. The
 * score is deliberately the narrowest cell on the screen and its components
 * the widest beside it: the figure is one number, and the four rows explaining
 * it are the part worth reading.
 */
const SPAN = {
  full: { base: 1, md: 6, lg: 12 },
  score: { base: 1, md: 2, lg: 4 },
  components: { base: 1, md: 4, lg: 8 },
  half: { base: 1, md: 6, lg: 6 },
} satisfies Record<string, BentoSpan>;

export function SuiviPage() {
  const reduced = useReducedMotion();

  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [categoryNames, setCategoryNames] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    // The two reads are independent, and only ONE of them is load-bearing.
    // `/categories` supplies a name for each challenge's own category; losing
    // it must not cost the household its streak, its score and its challenges,
    // so its failure is absorbed here and the card says the name could not be
    // retrieved rather than pretending there was no category at all.
    const [state, categories] = await Promise.all([
      api.get<Engagement>("/engagement"),
      api.get<Category[]>("/categories").catch(() => [] as Category[]),
    ]);
    setEngagement(state);
    setCategoryNames(new Map(categories.map((category) => [category.id, category.name])));
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await load();
      } catch (err) {
        if (cancelled) return;
        setEngagement(null);
        setError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function decide(id: number, decision: "accept" | "reject"): Promise<void> {
    setPendingId(id);
    setDecisionError(null);
    try {
      await api.post(`/engagement/challenges/${id}/${decision}`, {});
      // Re-read rather than patching the row from the POST's own body: that
      // body carries `outcome_unavailable_reason: null` by contract
      // (`api/engagement.py`'s `_decide`), and the reason a freshly accepted
      // challenge cannot be measured yet only exists on a subsequent read.
      await load();
    } catch (err) {
      setDecisionError(messageFor(err));
    } finally {
      setPendingId(null);
    }
  }

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement du suivi">
        <BentoCell span={SPAN.full} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--suivi-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--suivi-streak" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.score} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--suivi-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--suivi-card" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.components} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--suivi-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--suivi-card" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (engagement === null) {
    body = null;
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Régularité du suivi</h2>
          <StreakPanel streak={engagement.streak} />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.score} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Santé financière</h2>
          <HealthScoreSummary health={engagement.health} />
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.components}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Ce que le score mesure</h2>
          <HealthComponentList
            components={engagement.health.components}
            previousTakenOn={engagement.health.previous_taken_on}
          />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Évolution du score</h2>
          <HealthHistoryPanel health={engagement.health} />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.half} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Jalons d'objectifs</h2>
          <MilestonesPanel goals={engagement.goals} />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.half} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Défis mesurés sur vos relevés</h2>
          {decisionError !== null ? (
            <p role="alert" className="yd-suivi__alert">
              {decisionError}
            </p>
          ) : null}
          <ChallengeList
            challenges={engagement.challenges}
            categoryNames={categoryNames}
            onDecide={(id, decision) => void decide(id, decision)}
            pendingId={pendingId}
          />
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-suivi">
      <div className="yd-suivi__header">
        <h1>Suivi</h1>
        <p className="yd-suivi__lead">
          Ce que vos relevés disent de votre régularité, de votre santé financière et des marges
          qu'ils laissent apparaître. Chaque chiffre ici est une mesure prise sur vos propres
          opérations — jamais un badge, jamais un niveau.
        </p>
      </div>

      {error !== null ? (
        <p role="alert" className="yd-suivi__alert">
          {`Suivi indisponible : ${error}`}
        </p>
      ) : null}

      {body}
    </section>
  );
}
