import { useEffect, useId, useState } from "react";

import { formatCents, formatRateBps, parseRateBps } from "../../design/theme";
import type { ProjectionAssumptions } from "../../lib/types";
import type { ProjectionQuery } from "./query";
import { MAX_MONTHS, MAX_TRIALS } from "./query";

/**
 * Every hypothesis this screen's figures rest on, printed — design §10 — and
 * editable, because a projection whose assumptions the reader cannot move is a
 * verdict rather than a tool.
 *
 * **The seed is the first thing on the panel, not a footnote.** A Monte Carlo
 * run nobody can reproduce is not a measurement: `/api/projection` requires the
 * seed and refuses to invent one, so this screen carries it in the URL
 * (`?graine=`), shows it as a numeral, lets it be typed, and offers a new one
 * on a button. Nothing here is generated behind the reader's back — a fresh
 * seed changes the number on screen and the number in the address bar at the
 * same moment.
 *
 * Rates are integer basis points end to end (`formatRateBps` / `parseRateBps`);
 * no euro amount is ever parsed here, so `parseCents` has no business on this
 * panel.
 */
export function AssumptionsPanel({
  assumptions,
  query,
  onApply,
  onNewSeed,
  monthlyContributionCents,
}: {
  /** What the API actually ran with — echoed back, never what was typed. */
  assumptions: ProjectionAssumptions;
  /** What the URL currently holds, which is what the form edits. */
  query: ProjectionQuery;
  onApply: (next: ProjectionQuery) => void;
  onNewSeed: () => void;
  /** The measured savings capacity the Monte Carlo run contributes every
   *  month, signed — `null` when it could not be measured at all. */
  monthlyContributionCents: number | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(query));
  const [error, setError] = useState<string | null>(null);

  // A new run (a fresh seed, a bookmarked URL) must reset the form, or the
  // fields would keep showing what was typed before the run that is on screen.
  useEffect(() => setDraft(toDraft(query)), [query]);

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const parsed = fromDraft(draft);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    setError(null);
    onApply(parsed);
  }

  return (
    <div className="yd-assumptions">
      <div className="yd-assumptions__seed">
        <p className="yd-assumptions__seed-label">Graine de la simulation</p>
        <p className="yd-assumptions__seed-value" data-testid="yd-projection-seed">
          {assumptions.seed}
        </p>
        <p className="yd-assumptions__seed-note">
          Le tirage aléatoire part de ce nombre. À graine identique et hypothèses identiques,
          Yieldo redonne exactement la même bande — c'est ce qui rend cette projection
          vérifiable. Elle est aussi dans l'adresse de la page&nbsp;: copiez-la pour rejouer ce
          run à l'identique.
        </p>
        <button type="button" className="yd-assumptions__reseed" onClick={onNewSeed}>
          Nouvelle graine
        </button>
      </div>

      <dl className="yd-assumptions__list">
        <Fact label="Horizon" value={`${assumptions.months} mois`} note={`jusqu'au ${frenchMonth(assumptions.horizon_end_on)}`} />
        <Fact
          label="Rendement annuel supposé"
          value={formatRateBps(assumptions.annual_return_bps)}
          note="hypothèse déclarée, jamais mesurée : Yieldo ne consulte aucun historique de marché"
        />
        <Fact
          label="Volatilité annuelle supposée"
          value={formatRateBps(assumptions.annual_volatility_bps)}
          note="l'écart-type des rendements mensuels tirés ; c'est elle qui écarte les centiles"
        />
        <Fact
          label="Trajectoires simulées"
          value={assumptions.trials.toLocaleString("fr-FR")}
          note="chacune tire un rendement différent chaque mois ; la bande est leur distribution"
        />
        <Fact
          label="Versement mensuel"
          value={monthlyContributionCents === null ? "Non mesuré" : formatCents(monthlyContributionCents, { signed: true })}
          note={
            monthlyContributionCents === null
              ? "votre capacité d'épargne n'a pas pu être mesurée ; la simulation ne verse rien"
              : "votre capacité d'épargne mesurée, avec son signe — un mois déficitaire retire"
          }
        />
        <Fact
          label="Taux de retrait"
          value={formatRateBps(assumptions.withdrawal_rate_bps)}
          note="l'hypothèse derrière le capital cible et la rente : la « règle des 4 % » à votre taux"
        />
        <Fact
          label="Taux marginal d'imposition"
          value={assumptions.marginal_rate_bps === null ? "Non renseigné" : formatRateBps(assumptions.marginal_rate_bps)}
          note={
            assumptions.marginal_rate_bps === null
              ? "sans lui, l'option barème n'est pas chiffrée — elle n'est pas supposée nulle"
              : `option barème chiffrée à ce taux${assumptions.joint_taxation ? ", imposition commune" : ", contribuable seul"}`
          }
        />
      </dl>

      <button
        type="button"
        className="yd-assumptions__toggle"
        aria-expanded={open}
        aria-controls={`${id}-form`}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Masquer les hypothèses" : "Modifier les hypothèses"}
      </button>

      {open ? (
        <form id={`${id}-form`} className="yd-assumptions__form" onSubmit={apply} noValidate>
          <Field id={`${id}-seed`} label="Graine">
            <input
              id={`${id}-seed`}
              inputMode="numeric"
              value={draft.seed}
              onChange={(e) => setDraft({ ...draft, seed: e.target.value })}
            />
          </Field>
          <Field id={`${id}-months`} label="Horizon (mois)">
            <input
              id={`${id}-months`}
              inputMode="numeric"
              value={draft.months}
              onChange={(e) => setDraft({ ...draft, months: e.target.value })}
            />
          </Field>
          <Field id={`${id}-return`} label="Rendement annuel">
            <input
              id={`${id}-return`}
              inputMode="decimal"
              value={draft.annualReturn}
              onChange={(e) => setDraft({ ...draft, annualReturn: e.target.value })}
            />
          </Field>
          <Field id={`${id}-vol`} label="Volatilité annuelle">
            <input
              id={`${id}-vol`}
              inputMode="decimal"
              value={draft.volatility}
              onChange={(e) => setDraft({ ...draft, volatility: e.target.value })}
            />
          </Field>
          <Field id={`${id}-trials`} label="Trajectoires">
            <input
              id={`${id}-trials`}
              inputMode="numeric"
              value={draft.trials}
              onChange={(e) => setDraft({ ...draft, trials: e.target.value })}
            />
          </Field>
          <Field id={`${id}-withdrawal`} label="Taux de retrait">
            <input
              id={`${id}-withdrawal`}
              inputMode="decimal"
              value={draft.withdrawal}
              onChange={(e) => setDraft({ ...draft, withdrawal: e.target.value })}
            />
          </Field>
          <Field
            id={`${id}-tmi`}
            label="Taux marginal d'imposition"
            hint="Laissez vide pour ne pas chiffrer l'option barème. Vide n'est pas zéro : 0 % est une tranche réelle."
          >
            <input
              id={`${id}-tmi`}
              inputMode="decimal"
              value={draft.marginal}
              onChange={(e) => setDraft({ ...draft, marginal: e.target.value })}
            />
          </Field>
          <div className="yd-assumptions__check">
            <input
              id={`${id}-joint`}
              type="checkbox"
              checked={draft.joint}
              onChange={(e) => setDraft({ ...draft, joint: e.target.checked })}
            />
            <label htmlFor={`${id}-joint`}>
              Imposition commune (double l'abattement d'assurance-vie)
            </label>
          </div>

          {error !== null ? (
            <p className="yd-assumptions__error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="yd-assumptions__apply">
            Relancer la projection
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="yd-fact">
      <dt className="yd-fact__label">{label}</dt>
      <dd className="yd-fact__value">{value}</dd>
      <dd className="yd-fact__note">{note}</dd>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="yd-assumptions__field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint !== undefined ? <p className="yd-assumptions__hint">{hint}</p> : null}
    </div>
  );
}

interface Draft {
  seed: string;
  months: string;
  annualReturn: string;
  volatility: string;
  trials: string;
  withdrawal: string;
  marginal: string;
  joint: boolean;
}

function toDraft(query: ProjectionQuery): Draft {
  return {
    seed: String(query.seed),
    months: String(query.months),
    annualReturn: formatRateBps(query.annual_return_bps).replace(/[\s  ]?%$/, ""),
    volatility: formatRateBps(query.annual_volatility_bps).replace(/[\s  ]?%$/, ""),
    trials: String(query.trials),
    withdrawal: formatRateBps(query.withdrawal_rate_bps).replace(/[\s  ]?%$/, ""),
    marginal:
      query.marginal_rate_bps === null
        ? ""
        : formatRateBps(query.marginal_rate_bps).replace(/[\s  ]?%$/, ""),
    joint: query.joint_taxation,
  };
}

/** The draft back into a query, or a French sentence naming the ONE field that
 *  could not be read. Bounds mirror the API's own, so a value this form accepts
 *  is one the engines accept — a 422 round-trip to learn "600 max" is a worse
 *  answer than saying so here. */
function fromDraft(draft: Draft): ProjectionQuery | string {
  const seed = readInteger(draft.seed);
  if (seed === null) return "La graine doit être un nombre entier.";

  const months = readInteger(draft.months);
  if (months === null || months < 1 || months > MAX_MONTHS) {
    return `L'horizon doit être un nombre entier de mois compris entre 1 et ${MAX_MONTHS}.`;
  }

  const trials = readInteger(draft.trials);
  if (trials === null || trials < 1 || trials > MAX_TRIALS) {
    return `Le nombre de trajectoires doit être compris entre 1 et ${MAX_TRIALS}.`;
  }

  const annualReturn = readSignedRate(draft.annualReturn);
  if (annualReturn === null || annualReturn < -10_000 || annualReturn > 10_000) {
    return "Le rendement annuel doit être un pourcentage compris entre −100 % et 100 %.";
  }

  const volatility = parseRateBps(draft.volatility);
  if (volatility === null) {
    return "La volatilité annuelle doit être un pourcentage positif, par exemple 15,00.";
  }

  const withdrawal = parseRateBps(draft.withdrawal);
  if (withdrawal === null || withdrawal < 1 || withdrawal > 10_000) {
    return "Le taux de retrait doit être un pourcentage strictement positif et au plus 100 %.";
  }

  // Empty means "do not price the barème at all", which is NOT the same answer
  // as a marginal rate of 0 % — that is a real, very low bracket.
  const marginal = draft.marginal.trim() === "" ? null : parseRateBps(draft.marginal);
  if (draft.marginal.trim() !== "" && (marginal === null || marginal > 10_000)) {
    return "Le taux marginal d'imposition doit être un pourcentage compris entre 0 % et 100 %, ou rester vide.";
  }

  return {
    seed,
    months,
    annual_return_bps: annualReturn,
    annual_volatility_bps: volatility,
    trials,
    withdrawal_rate_bps: withdrawal,
    marginal_rate_bps: marginal,
    joint_taxation: draft.joint,
  };
}

function readInteger(text: string): number | null {
  const cleaned = text.replace(/[\s  ]/g, "");
  return /^-?\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/** `parseRateBps` refuses a negative on purpose (no rate it was written for can
 *  be one). A Monte Carlo return CAN be — modelling a sustained bear market is
 *  half the reason that engine exists — so the sign is handled here and the
 *  magnitude still goes through the shared parser. */
function readSignedRate(text: string): number | null {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-") || trimmed.startsWith("−");
  const magnitude = parseRateBps(negative ? trimmed.slice(1) : trimmed);
  if (magnitude === null) return null;
  return negative ? -magnitude : magnitude;
}

function frenchMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
