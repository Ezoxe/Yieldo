import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { Periodicity, Recurrence, RecurrenceStatus } from "../../lib/types";

export const PERIODICITY_LABEL: Record<Periodicity, string> = {
  weekly: "Hebdomadaire",
  biweekly: "Toutes les deux semaines",
  monthly: "Mensuel",
  quarterly: "Trimestriel",
  yearly: "Annuel",
};

/**
 * The engine's own annualisation floor (`MIN_ANNUALISATION_SPAN_DAYS` in
 * `backend/app/engines/recurrence.py`), repeated here only to *name* it in
 * French copy. Nothing on this screen is computed from it -- the gate itself
 * travels on the wire as `Recurrence.annualisable`, so a change of floor on
 * the backend cannot leave the screen silently applying the old one; it would
 * only leave this sentence naming the wrong number, which is visible.
 */
export const ANNUALISATION_FLOOR_DAYS = 91;

/**
 * How much a charge may wobble and still read as one price. A real
 * subscription moves by an FX rounding or not at all; anything past a
 * twentieth of the level is a group of different purchases wearing one label.
 */
const UNSTABLE_SPREAD_RATIO = 0.05;

/**
 * Status in words. `ended` deliberately does **not** say "interrompu",
 * "résilié" or anything else that asserts a cancellation: the engine's clock
 * is the ledger's own last date, so "ended" means "no charge before the
 * statements ran out", which is a fact about the import history and not about
 * the subscription. See `statusSentence` for the rest of that sentence.
 */
const STATUS_LABEL: Record<RecurrenceStatus, string> = {
  active: "Actif",
  missing: "Prélèvement manquant",
  ended: "Sans prélèvement récent",
};

/**
 * A signed ratio as a French percentage with one decimal: 0.185 → "+18,5 %".
 * Uses the same typographic minus as `formatCents` so a column of figures and
 * a column of percentages line up on the same glyph.
 */
export function formatRatio(ratio: number): string {
  const percent = Math.abs(ratio * 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const sign = ratio < 0 ? "−" : "+";
  return `${sign}${percent} %`;
}

export interface SpreadDescription {
  text: string;
  /** True when the amounts are too scattered to be one price. */
  unstable: boolean;
}

/**
 * What `amount_spread_cents` means, in a sentence.
 *
 * This is the only defence the screen has against a clockwork
 * non-subscription. `normalize_label` strips the card suffix, so every cash
 * withdrawal in a ledger collapses into the single key `retrait dab`: a
 * flawless weekly rhythm of wildly varying amounts, which the engine detects
 * and explicitly refuses to vouch for (see `detect_recurrences`' docstring --
 * "the caller must use it"). Printing the spread is that use.
 *
 * A zero level cannot be divided into, and is treated as unstable whenever it
 * scatters at all -- an amount averaging nothing while moving is not a price.
 */
export function describeSpread(amountCents: number, spreadCents: number): SpreadDescription {
  const spread = Math.abs(spreadCents);
  const level = Math.abs(amountCents);
  if (spread === 0) {
    return { text: "Montant constant d'une échéance à l'autre.", unstable: false };
  }
  const figures = `±${formatCents(spread)} autour de ${formatCents(level)}`;
  const unstable = level === 0 || spread / level >= UNSTABLE_SPREAD_RATIO;
  return {
    text: unstable ? `Montant variable : ${figures}.` : `Montant quasi constant : ${figures}.`,
    unstable,
  };
}

/**
 * Why this recurrence takes no part in the annual subscription total, or null
 * when it does.
 *
 * Mirrors the engine's own summing condition exactly -- `annualisable and
 * annual_cents < 0 and status != "ended"` -- and in that order, so a row that
 * fails two of the three names the first one the engine would have stopped
 * at. Being the single source of both the grouping on screen and the sentence
 * on the row, the list and the total cannot disagree about which is which.
 */
export function exclusionReason(recurrence: Recurrence): string | null {
  if (!recurrence.annualisable) {
    return `Pas encore annualisé : moins de ${ANNUALISATION_FLOOR_DAYS} jours d'observation.`;
  }
  if (recurrence.annual_cents >= 0) {
    return "Revenu récurrent : ce n'est pas un coût d'abonnement.";
  }
  if (recurrence.status === "ended") {
    return "Plus de prélèvement dans l'historique : retiré du total.";
  }
  return null;
}

/** Whole days from one ISO date to another, negative when `to` is earlier. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * What the ledger's own last date lets us say about a silence — and, just as
 * importantly, what it does not.
 *
 * The backend hands the engine `ledger_last_on` as its `today`, so a "missing"
 * or "ended" status only ever means "no charge before the data ran out". Which
 * of the two readings that supports depends entirely on *where* the data ran
 * out relative to the charge that was due:
 *
 * - The ledger stops on or before the expected date. Nothing has been observed
 *   about that charge at all; the silence is the import history's, not the
 *   merchant's. Asserting a cancellation here would be pure invention — the
 *   operator has simply not imported a statement since.
 * - The ledger runs on past the expected date. Now the statements *did* keep
 *   arriving and the charge did not, which is a real, data-backed observation
 *   — so the sentence reports the gap in days and stops there. Still not a
 *   cancellation: a card could have been re-issued under a new label. The
 *   reader is given the fact and left to draw the conclusion.
 */
function ledgerClause(recurrence: Recurrence, ledgerLastOn: string | null): string {
  if (ledgerLastOn === null) return "";
  const after = daysBetween(recurrence.expected_next_on, ledgerLastOn);
  if (after <= 0) {
    return ` Le ${frenchDate(ledgerLastOn)} est la dernière date de votre historique, antérieure à cette échéance : rien ne dit que le prélèvement a cessé, il se peut simplement qu'aucun relevé plus récent n'ait été importé.`;
  }
  return ` Le ${frenchDate(ledgerLastOn)} est la dernière date de votre historique, soit ${after} ${plural(after, "jour", "jours")} après l'échéance attendue : vos relevés se sont poursuivis sans ce prélèvement.`;
}

function statusSentence(recurrence: Recurrence, ledgerLastOn: string | null): string {
  if (recurrence.status === "active") {
    return `Prochaine échéance attendue le ${frenchDate(recurrence.expected_next_on)}.`;
  }
  const ledger = ledgerClause(recurrence, ledgerLastOn);
  if (recurrence.status === "missing") {
    return `Attendu le ${frenchDate(recurrence.expected_next_on)}, il n'est pas arrivé.${ledger}`;
  }
  return `Aucun prélèvement depuis le ${frenchDate(recurrence.last_on)}.${ledger}`;
}

interface RecurrenceRowProps {
  recurrence: Recurrence;
  /**
   * The ledger's own last date — the clock the backend judged every status
   * against. Null only when the ledger is empty, in which case there are no
   * recurrences to render either.
   */
  ledgerLastOn: string | null;
}

export function RecurrenceRow({ recurrence, ledgerLastOn }: RecurrenceRowProps) {
  const change = recurrence.price_change;
  const spread = describeSpread(recurrence.amount_cents, recurrence.amount_spread_cents);
  const reason = exclusionReason(recurrence);

  const classes = [
    "yd-recurrence",
    `yd-recurrence--${recurrence.status}`,
    spread.unstable ? "yd-recurrence--unstable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={classes}>
      <div className="yd-recurrence__head">
        <span className="yd-recurrence__label">
          {recurrence.category_color !== null ? (
            <span
              className="yd-recurrence__dot"
              style={{ background: recurrence.category_color }}
              aria-hidden="true"
            />
          ) : null}
          {recurrence.label}
        </span>
        {/* Signed, always: a recurring credit and a recurring debit are two
            different objects and the sign is the only thing telling them
            apart at a glance. */}
        <span className="yd-recurrence__amount yd-num">
          {formatCents(recurrence.amount_cents, { signed: true })}
        </span>
      </div>

      <p className="yd-recurrence__meta">
        <span className="yd-recurrence__periodicity">
          {PERIODICITY_LABEL[recurrence.periodicity]}
        </span>
        {recurrence.category_name !== null ? ` · ${recurrence.category_name}` : ""}
        {` · tous les ${recurrence.median_interval_days} ${plural(recurrence.median_interval_days, "jour", "jours")}`}
      </p>

      <p className="yd-recurrence__span">
        {`${recurrence.occurrences} ${plural(recurrence.occurrences, "opération", "opérations")}, du ${frenchDate(recurrence.first_on)} au ${frenchDate(recurrence.last_on)}.`}
      </p>

      {/* The 91-day bar, at the one place it can still leak: a figure the
          payload carries but that means nothing yet. `annual_cents` is not
          rendered at all when `annualisable` is false -- not greyed, not
          parenthesised, absent -- and what replaces it is the window that was
          actually observed. */}
      {recurrence.annualisable ? (
        <p className="yd-recurrence__annual yd-num">
          {`${formatCents(recurrence.annual_cents, { signed: true })} par an au rythme observé.`}
        </p>
      ) : (
        <p className="yd-recurrence__observed">
          {`Observé sur ${recurrence.observed_span_days} ${plural(recurrence.observed_span_days, "jour", "jours")} seulement : trop court pour en déduire un coût annuel.`}
        </p>
      )}

      <p className={`yd-recurrence__spread${spread.unstable ? " yd-recurrence__spread--unstable" : ""}`}>
        {spread.text}
        {spread.unstable
          ? " Un abonnement ne varie pas ainsi : ce libellé regroupe peut-être plusieurs opérations différentes."
          : ""}
      </p>

      <p className="yd-recurrence__status">
        <span className={`yd-recurrence__badge yd-recurrence__badge--${recurrence.status}`}>
          {STATUS_LABEL[recurrence.status]}
        </span>
        {` — ${statusSentence(recurrence, ledgerLastOn)}`}
      </p>

      {/* Confidence is stated in words, never implied by a lighter colour:
          three occurrences is the floor at which regularity can be tested at
          all, and the reader is entitled to know this one rests on it. */}
      {recurrence.confidence === "probable" ? (
        <p className="yd-recurrence__confidence">
          {`Probable : la régularité ne repose que sur ${recurrence.occurrences} occurrences.`}
        </p>
      ) : null}

      {change !== null ? (
        <p className="yd-recurrence__change">
          {`${formatCents(Math.abs(change.previous_cents))} → ${formatCents(Math.abs(change.current_cents))} le ${frenchDate(change.changed_on)}, `}
          <strong>{formatRatio(change.ratio)}</strong>
        </p>
      ) : null}

      {reason !== null ? <p className="yd-recurrence__excluded">{reason}</p> : null}
    </li>
  );
}
