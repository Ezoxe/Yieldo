import type { ReactNode } from "react";

import { centsToInput, parseCents } from "../../design/theme";

/**
 * A percentage typed with two decimals IS integer basis points, in exactly the
 * way an amount typed with two decimals is integer cents — "3,50" is 350 bps.
 * So the euro parser is the rate parser, string arithmetic and all, and no
 * float ever multiplies a rate into a cents value. `PurchaseForm` makes the
 * same aliasing for the same reason.
 */
export const parseBps = parseCents;
export const bpsToInput = centsToInput;

/**
 * `schemas/simulators.py`'s own monetary and rate ceilings, mirrored so the
 * field says no in French before the network does.
 *
 * Only these two are mirrored. Every DURATION is deliberately left to the
 * engine: `schemas/simulators.py` states outright that `months`, `loan_months`
 * and `years` are unbounded in Pydantic so that `amortization.build_schedule`
 * and `savings.project_savings` can refuse them with their own precise French
 * sentence — "comprise entre 1 et 480 mois", "entre 1 et 600 mois". Mirroring
 * those here would make the two disagree about which value is actually
 * rejected, and would hide a refusal this screen is supposed to show.
 */
export const MAX_AMOUNT_CENTS = 100_000_000_00;
export const MAX_RATE_BPS = 100_000;

/** A whole number, refused rather than coerced. `null` on anything else — never
 *  0, which would silently send a duration nobody typed. */
export function parseCount(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** "240 mois" → "20 ans". "" when the count is not a readable duration, so a
 *  half-typed field shows no hint rather than a wrong one. */
export function yearsHint(text: string): string {
  const months = parseCount(text, 0, 100_000);
  if (months === null || months < 12) return "";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = `${years} ${years > 1 ? "ans" : "an"}`;
  return rest === 0 ? yearPart : `${yearPart} et ${rest} mois`;
}

export type Errors = Record<string, string>;

export interface SimFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  /** What the value means, or what it converts to. Never a restatement of the
   *  label, and never the error slot — an error replaces nothing here, it is
   *  announced separately below. */
  hint?: string | null;
  error?: string;
  placeholder?: string;
  /** `amount` and `rate` take a decimal keypad, `count` a numeric one. */
  kind?: "amount" | "rate" | "count";
}

/**
 * One labelled input, with its hint and its error.
 *
 * The label is always visible and always `htmlFor`-bound: a placeholder is not
 * a label, and it disappears the moment the user types. The error is
 * `role="alert"` and sits beside the field it belongs to, not in a summary at
 * the top of the form.
 */
export function SimField({
  id,
  label,
  value,
  onChange,
  hint = null,
  error,
  placeholder,
  kind = "amount",
}: SimFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error !== undefined ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="yd-simfield">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode={kind === "count" ? "numeric" : "decimal"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
      />
      {hint ? (
        <p id={hintId} className="yd-simfield__hint">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} role="alert" className="yd-simfield__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A `<select>` in the same clothes as {@link SimField}. */
export function SimSelect({
  id,
  label,
  value,
  onChange,
  hint = null,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string | null;
  children: ReactNode;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="yd-simfield">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? hintId : undefined}
      >
        {children}
      </select>
      {hint ? (
        <p id={hintId} className="yd-simfield__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One headline figure, with what it is and what it rests on.
 *
 * `lead` is the figure the reader came for. It is marked by size and by its
 * card, never by a colour: an instalment is neither good news nor bad. `tone`
 * exists for the one case where the sign IS the message — a savings plan
 * ending below zero — and is otherwise left alone.
 */
export function Figure({
  testId,
  label,
  value,
  note,
  lead = false,
  negative = false,
}: {
  testId: string;
  label: string;
  value: string;
  note: ReactNode;
  lead?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`yd-sim__figure${lead ? " yd-sim__figure--lead" : ""}`}
      data-testid={testId}
    >
      <span className="yd-sim__figure-label">{label}</span>
      <span
        className={`yd-sim__figure-value${negative ? " yd-sim__figure-value--negative" : ""}`}
      >
        {value}
      </span>
      <span className="yd-sim__figure-note">{note}</span>
    </div>
  );
}

/**
 * The result column's three states, in the one order every simulator renders
 * them: a genuine failure is an alert, an engine's refusal is content, and a
 * result is a result. Written once so the three tabs cannot drift on which of
 * the three a 422 belongs to.
 */
export function ResultShell({
  busy,
  failure,
  refusal,
  empty,
  children,
}: {
  busy: boolean;
  failure: string | null;
  refusal: string | null;
  /** What to show before anything has been asked. */
  empty: ReactNode;
  children: ReactNode | null;
}) {
  if (failure !== null) {
    return (
      <p role="alert" className="yd-sim__alert">
        {`Le calcul n'a pas abouti : ${failure}`}
      </p>
    );
  }
  if (refusal !== null) {
    // Verbatim. Each engine refusal in this phase names its own distinct cause
    // — a term out of range, an instalment that would not cover the first
    // month's interest — and paraphrasing them would blur which one applies.
    return <p className="yd-sim__refusal">{refusal}</p>;
  }
  if (busy) return <p className="yd-sim__busy">Calcul en cours…</p>;
  return <>{children ?? empty}</>;
}
