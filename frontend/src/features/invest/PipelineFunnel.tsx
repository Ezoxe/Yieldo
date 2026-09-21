import { OUTCOME_LABELS, OUTCOME_TONE } from "./vocabulary";
import type { DecisionOutcome } from "../../lib/types";
import "./invest.css";

export interface StageCount {
  outcome: DecisionOutcome;
  count: number;
}

interface PipelineFunnelProps {
  /** How many instruments were examined over the window. */
  examined: number;
  stages: StageCount[];
}

/**
 * Where the instruments went: one row per outcome, with its count and share.
 *
 * **Deliberately not a stacked bar, and not a tapering funnel.** Two reasons,
 * and the second is the load-bearing one:
 *
 * * The five outcomes are what a *sequence of gates* produced, not a
 *   composition anybody compares by area. What a reader needs is where
 *   instruments dropped out, stage by stage — which is a list of magnitudes on
 *   a shared scale, the form a bar chart exists for.
 * * Stacking them would put « Refusé » (amber) directly against « En échec »
 *   (rose), and those two are ΔE 11,5 apart to normal vision in the light
 *   theme and ΔE 5,1 under deuteranopia — measured, not guessed. Adjacent
 *   segments a reader cannot separate is the whole defect. On separate
 *   baselines nothing is adjacent, so the question does not arise.
 *
 * Colour is never the only channel: every row carries its French label and its
 * count, and the tint is a reading aid on top of them.
 *
 * The bars share one scale — `examined`, not the largest stage — so a stage
 * holding four instruments out of two hundred looks like four out of two
 * hundred rather than like a full bar.
 */
export function PipelineFunnel({ examined, stages }: PipelineFunnelProps) {
  const total = Math.max(examined, 1);
  return (
    <div className="yd-funnel">
      <ol className="yd-funnel__list">
        {stages.map((stage) => {
          const share = Math.round((stage.count / total) * 100);
          return (
            <li key={stage.outcome} className="yd-funnel__row">
              <span className="yd-funnel__label">{OUTCOME_LABELS[stage.outcome]}</span>
              <span
                className="yd-funnel__track"
                role="img"
                aria-label={`${stage.count} sur ${examined}, soit ${share} %`}
              >
                {/* A stage that held nothing draws NOTHING. The bar has a
                    two-pixel minimum so a real but tiny stage stays visible,
                    and that minimum turned zero into a mark claiming a stage
                    had happened. */}
                {stage.count > 0 ? (
                  <span
                    className={`yd-funnel__bar yd-funnel__bar--${OUTCOME_TONE[stage.outcome]}`}
                    style={{ inlineSize: `${(stage.count / total) * 100}%` }}
                  />
                ) : null}
              </span>
              <span className="yd-funnel__count yd-num">{stage.count}</span>
              <span className="yd-funnel__share yd-num">{share}&nbsp;%</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
