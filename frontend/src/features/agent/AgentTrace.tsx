import type { AgentStep, AgentStepKind } from "../../lib/types";
import "./AgentTrace.css";

const KIND_LABELS: Record<AgentStepKind, string> = {
  thought: "Réflexion",
  tool_call: "Consultation",
  tool_result: "Résultat",
  answer: "Conclusion",
  failure: "Échec",
};

interface AgentTraceProps {
  steps: AgentStep[];
}

/**
 * What the model actually ran, in the order it ran it.
 *
 * A sibling of `assistant/ReasoningTrace`, and deliberately not the same
 * component: that one prints a DECLARED trace — the engines a recognised
 * question is known to use — while this one prints an OBSERVED one, the tool
 * calls a model chose to make. Merging them would put a claim and a
 * measurement behind the same heading.
 *
 * Nothing here is inferred and nothing is staggered into a fake progress
 * report: the steps are the rows the run wrote as it went, rendered once it
 * came back. While a run is in flight the page says only what it can see —
 * one request is running.
 */
export function AgentTrace({ steps }: AgentTraceProps) {
  if (steps.length === 0) return null;

  return (
    <details className="yd-trace" open>
      <summary>Ce que l'IA a réellement fait</summary>
      <ol className="yd-trace__list">
        {steps.map((step) => (
          <li key={step.position} className={`yd-trace__step yd-trace__step--${step.kind}`}>
            <span className="yd-trace__kind">{KIND_LABELS[step.kind] ?? step.kind}</span>
            {step.name !== "" ? <span className="yd-trace__tool">{step.name}</span> : null}
            <p className="yd-trace__summary">{step.summary}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
