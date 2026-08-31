import { useId, useState, type FormEvent } from "react";

import { SavingsChart } from "../../charts/SavingsChart";
import { EmptyState } from "../../design/EmptyState";
import { formatCents, formatRateBps, parseCents } from "../../design/theme";
import { api } from "../../lib/api";
import { messageFor, refusalReason } from "../../lib/refusal";
import type { SavingsRequest, SavingsSimulation } from "../../lib/types";
import {
  MAX_AMOUNT_CENTS,
  MAX_RATE_BPS,
  Figure,
  ResultShell,
  SimField,
  bpsToInput,
  parseBps,
  parseCount,
  yearsHint,
  type Errors,
} from "./fields";

/** See `CreditSimulator`'s copy: the engine owns the real bound (1 to 600
 *  months) and says so in French; this only keeps a mistyped field from
 *  becoming a request. */
const MAX_TYPED_MONTHS = 9_999;

/**
 * "Et si je mettais X de côté ?" — where a savings plan ends up, and what part
 * of it the pot earned rather than the saver paid in.
 *
 * **A monthly contribution may be negative**, and the field says so rather than
 * silently rejecting a minus sign. A withdrawal plan is a real question, the
 * engine models it without clamping, and the balance is allowed to cross zero
 * and keep going — which is exactly what the operator's own measured capacity
 * of −746,19 €/month does.
 */
export function SavingsSimulator() {
  const baseId = useId();
  const [initial, setInitial] = useState("1000,00");
  const [monthly, setMonthly] = useState("200,00");
  const [rate, setRate] = useState("3,00");
  const [months, setMonths] = useState("120");

  const [errors, setErrors] = useState<Errors>({});
  const [result, setResult] = useState<SavingsSimulation | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldId = (name: string) => `${baseId}-${name}`;

  function clearError(name: string) {
    setErrors((current) => {
      if (current[name] === undefined) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  /** Both amounts are allowed to be negative — see the component's doc. Only
   *  their MAGNITUDE is bounded, and by the schema's own ceiling. */
  function amountError(cents: number | null, what: string): string | undefined {
    if (cents === null) return `Montant illisible : saisissez ${what}, par exemple 1 000,00.`;
    if (Math.abs(cents) > MAX_AMOUNT_CENTS) {
      return `Montant hors limites : ce simulateur s'arrête à ${formatCents(MAX_AMOUNT_CENTS)}.`;
    }
    return undefined;
  }

  function validate(): { request: SavingsRequest } | { errors: Errors } {
    const found: Errors = {};

    const initialCents = parseCents(initial);
    const initialProblem = amountError(initialCents, "un montant en euros");
    if (initialProblem !== undefined) found.initial = initialProblem;

    const monthlyCents = parseCents(monthly);
    const monthlyProblem = amountError(
      monthlyCents,
      "un versement en euros, précédé d'un moins pour un retrait",
    );
    if (monthlyProblem !== undefined) found.monthly = monthlyProblem;

    const rateBps = parseBps(rate);
    if (rateBps === null || rateBps < 0 || rateBps > MAX_RATE_BPS) {
      found.rate = `Taux illisible : un pourcentage entre 0,00 et ${bpsToInput(MAX_RATE_BPS)}.`;
    }

    const term = parseCount(months, 0, MAX_TYPED_MONTHS);
    if (term === null) {
      found.months = "Durée illisible : saisissez un nombre entier de mois, par exemple 120.";
    }

    if (Object.keys(found).length > 0) return { errors: found };
    return {
      request: {
        initial_cents: initialCents as number,
        monthly_cents: monthlyCents as number,
        annual_rate_bps: rateBps as number,
        months: term as number,
      },
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validate();
    if ("errors" in checked) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setRefusal(null);
    setFailure(null);
    try {
      setResult(await api.post<SavingsSimulation>("/simulators/epargne", checked.request));
    } catch (err) {
      const reason = refusalReason(err);
      setResult(null);
      if (reason !== null) setRefusal(reason);
      else setFailure(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yd-sim">
      <form className="yd-sim__form" onSubmit={submit} noValidate>
        <div className="yd-sim__grid">
          <SimField
            id={fieldId("initial")}
            label="Montant de départ (€)"
            value={initial}
            onChange={(text) => {
              setInitial(text);
              clearError("initial");
            }}
            error={errors.initial}
            placeholder="1 000,00"
            hint="Ce qui est déjà de côté. Peut être négatif si vous partez d'un découvert."
          />
          <SimField
            id={fieldId("monthly")}
            label="Versement mensuel (négatif pour un retrait) (€)"
            value={monthly}
            onChange={(text) => {
              setMonthly(text);
              clearError("monthly");
            }}
            error={errors.monthly}
            placeholder="200,00"
            hint="Versé en fin de mois : il ne rapporte rien le mois où il est fait."
          />
          <SimField
            id={fieldId("rate")}
            label="Taux de rendement annuel (%)"
            kind="rate"
            value={rate}
            onChange={(text) => {
              setRate(text);
              clearError("rate");
            }}
            error={errors.rate}
            placeholder="3,00"
          />
          <SimField
            id={fieldId("months")}
            label="Durée (mois)"
            kind="count"
            value={months}
            onChange={(text) => {
              setMonths(text);
              clearError("months");
            }}
            error={errors.months}
            hint={yearsHint(months) || null}
          />
        </div>
        <button type="submit" className="yd-sim__submit" disabled={busy}>
          {busy ? "Calcul en cours…" : "Calculer l'épargne"}
        </button>
      </form>

      <ResultShell
        busy={busy}
        failure={failure}
        refusal={refusal}
        empty={
          <EmptyState
            title="Aucune projection lancée."
            detail="Saisissez un montant de départ, un versement mensuel et une durée. Le versement peut être négatif : un plan de retrait est une question comme une autre, et la courbe passera sous zéro si c'est là qu'elle va."
          />
        }
      >
        {result === null ? null : (
          <div className="yd-sim__result">
            <div className="yd-sim__figures">
              <Figure
                testId="yd-savings-final"
                lead
                label="Solde final"
                negative={result.final_cents < 0}
                value={formatCents(result.final_cents, { signed: true })}
                note={`Au bout de ${result.months} mois, intérêts composés chaque mois.`}
              />
              <Figure
                testId="yd-savings-contributed"
                label="Versé sur la période"
                value={formatCents(result.contributed_cents, { signed: true })}
                note={`Hors mise de départ de ${formatCents(result.initial_cents)}.`}
              />
              <Figure
                testId="yd-savings-interest"
                label="Intérêts gagnés"
                value={formatCents(result.interest_cents)}
                note="Un solde négatif ne rapporte rien : c'est un découvert, pas un placement."
              />
            </div>

            {result.final_cents < 0 ? (
              // Said outright, because a negative final balance is the ANSWER on
              // a withdrawal plan and a reader should not have to decode a minus
              // sign to learn it.
              <p className="yd-sim__consequence">
                {`Ce plan épuise l'épargne avant la fin : au bout de ${result.months} mois le solde est de ${formatCents(result.final_cents, { signed: true })}. La courbe passe sous zéro et continue — rien n'est ramené à zéro pour faire joli.`}
              </p>
            ) : null}

            {/* Design §10 and §2 ("pas un conseiller financier"), together. */}
            <p className="yd-sim__assumptions" data-testid="yd-savings-assumption">
              {`Le taux de ${formatRateBps(result.annual_rate_bps)} par an est une hypothèse que vous avez saisie, pas une mesure et pas une prévision. Yieldo ne va chercher aucun taux du marché, ne connaît aucun produit d'épargne et n'est pas un conseiller financier : il calcule ce que vos chiffres impliquent, rien de plus.`}
            </p>

            <SavingsChart projection={result} />
          </div>
        )}
      </ResultShell>
    </div>
  );
}
