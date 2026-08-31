import { useId, useState, type FormEvent } from "react";

import { AmortizationChart } from "../../charts/AmortizationChart";
import { EmptyState } from "../../design/EmptyState";
import { formatCents, formatRateBps, parseCents } from "../../design/theme";
import { api } from "../../lib/api";
import { messageFor, refusalReason } from "../../lib/refusal";
import type { CreditSimulation, ScheduleRow } from "../../lib/types";
import {
  MAX_AMOUNT_CENTS,
  MAX_RATE_BPS,
  Figure,
  ResultShell,
  SimField,
  SimSelect,
  bpsToInput,
  parseBps,
  parseCount,
  yearsHint,
  type Errors,
} from "./fields";

/**
 * A duration this form will send. Not the engine's bound: `amortization`
 * refuses anything outside 1..480 with its own French sentence, and
 * `schemas/simulators.py` deliberately leaves `months` unvalidated so that
 * sentence is what the user reads. This ceiling exists only so a field holding
 * a phone number does not become a request.
 */
const MAX_TYPED_MONTHS = 9_999;

/** Twelve rows per year, the same grouping `api/simulators._yearly_rollup`
 *  uses, so the table's "An 3" is the chart's third bar and not an off-by-one
 *  view of it. */
function rowsForYear(rows: ScheduleRow[], year: number): ScheduleRow[] {
  return rows.slice((year - 1) * 12, year * 12);
}

/**
 * "Et si j'empruntais X ?" — the instalment, what it costs, and where each
 * instalment actually goes.
 *
 * **The schedule table is bounded to one year at a time, and that is a
 * decision, not a limitation.** A mortgage runs to 240 rows and a
 * `MAX_LOAN_MONTHS` loan to 480; rendering them all puts hundreds of DOM rows
 * on a page that already carries a canvas, and nobody reads row 173. The chart
 * answers the question the whole table exists for — how the interest/capital
 * split inverts over the term — in twenty bars, and the table below it walks
 * the exact instalments a year at a time through its own selector. Every row is
 * reachable; none of them are all mounted at once. The CSV export beside the
 * chart carries the yearly figures it draws.
 */
export function CreditSimulator() {
  const baseId = useId();
  const [principal, setPrincipal] = useState("20000,00");
  const [rate, setRate] = useState("4,50");
  const [months, setMonths] = useState("60");

  const [errors, setErrors] = useState<Errors>({});
  const [result, setResult] = useState<CreditSimulation | null>(null);
  // Three states, never one boolean derived from two of them: a network
  // failure is an alert, an engine's refusal is content, and a result is a
  // result.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [openSchedule, setOpenSchedule] = useState(false);
  const [shownYear, setShownYear] = useState(1);

  const fieldId = (name: string) => `${baseId}-${name}`;

  /** Clears one field's error as it is retyped, and leaves the others alone. */
  function clearError(name: string) {
    setErrors((current) => {
      if (current[name] === undefined) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function validate(): { request: { principal_cents: number; annual_rate_bps: number; months: number } } | { errors: Errors } {
    const found: Errors = {};

    const principalCents = parseCents(principal);
    if (principalCents === null) {
      found.principal =
        "Montant illisible : saisissez un capital en euros, par exemple 100 000,00.";
    } else if (principalCents < 0) {
      found.principal = "Le capital emprunté ne peut pas être négatif.";
    } else if (principalCents > MAX_AMOUNT_CENTS) {
      found.principal = `Montant hors limites : ce simulateur s'arrête à ${formatCents(MAX_AMOUNT_CENTS)}.`;
    }

    const rateBps = parseBps(rate);
    if (rateBps === null || rateBps < 0 || rateBps > MAX_RATE_BPS) {
      found.rate = `Taux illisible : un pourcentage entre 0,00 et ${bpsToInput(MAX_RATE_BPS)}.`;
    }

    const term = parseCount(months, 0, MAX_TYPED_MONTHS);
    if (term === null) {
      found.months = "Durée illisible : saisissez un nombre entier de mois, par exemple 240.";
    }

    if (Object.keys(found).length > 0) return { errors: found };
    return {
      request: {
        principal_cents: principalCents as number,
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
      const body = await api.post<CreditSimulation>("/simulators/credit", checked.request);
      setResult(body);
      setShownYear(1);
      setOpenSchedule(false);
    } catch (err) {
      const reason = refusalReason(err);
      setResult(null);
      if (reason !== null) setRefusal(reason);
      else setFailure(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const rows = result === null ? [] : rowsForYear(result.rows, shownYear);

  return (
    <div className="yd-sim">
      <form className="yd-sim__form" onSubmit={submit} noValidate>
        <div className="yd-sim__grid">
          <SimField
            id={fieldId("principal")}
            label="Capital emprunté (€)"
            value={principal}
            onChange={(text) => {
              setPrincipal(text);
              clearError("principal");
            }}
            error={errors.principal}
            placeholder="100 000,00"
          />
          <SimField
            id={fieldId("rate")}
            label="Taux annuel (%)"
            kind="rate"
            value={rate}
            onChange={(text) => {
              setRate(text);
              clearError("rate");
            }}
            error={errors.rate}
            placeholder="3,00"
            hint="Taux nominal, hors assurance."
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
          {busy ? "Calcul en cours…" : "Calculer le crédit"}
        </button>
      </form>

      <ResultShell
        busy={busy}
        failure={failure}
        refusal={refusal}
        empty={
          <EmptyState
            title="Aucun crédit simulé."
            detail="Saisissez un capital, un taux et une durée, puis lancez le calcul. Rien n'est envoyé nulle part : le calcul se fait sur vos chiffres, pas sur une offre de banque."
          />
        }
      >
        {result === null ? null : (
          <div className="yd-sim__result">
            <div className="yd-sim__figures">
              <Figure
                testId="yd-credit-payment"
                lead
                label="Mensualité"
                value={formatCents(result.monthly_payment_cents)}
                note={`Constante sur ${result.months} mois. La dernière échéance diffère de quelques centimes : c'est là qu'atterrit l'arrondi, pour que le capital tombe exactement à zéro.`}
              />
              <Figure
                testId="yd-credit-interest"
                label="Intérêts totaux"
                value={formatCents(result.total_interest_cents)}
                note="Ce que le crédit coûte, en plus du capital."
              />
              <Figure
                testId="yd-credit-total"
                label="Total remboursé"
                value={formatCents(result.total_paid_cents)}
                note={`${formatCents(result.principal_cents)} de capital et ${formatCents(result.total_interest_cents)} d'intérêts.`}
              />
            </div>

            {/* Design §10: the hypotheses beside the result they produced. */}
            <p className="yd-sim__assumptions">
              {`Hypothèses : ${formatRateBps(result.annual_rate_bps)} par an en taux nominal, mensualités constantes, sur ${result.months} mois, hors assurance emprunteur et hors frais de dossier. Yieldo ne va chercher aucun taux du marché — celui-ci est celui que vous avez saisi.`}
            </p>

            <AmortizationChart
              years={result.years}
              months={result.months}
              totalInterestCents={result.total_interest_cents}
            />

            <div className="yd-sim__disclosure">
              <button
                type="button"
                className="yd-sim__toggle"
                aria-expanded={openSchedule}
                onClick={() => setOpenSchedule((open) => !open)}
              >
                {`Tableau d'amortissement (${openSchedule ? "masquer" : "afficher"})`}
              </button>
            </div>

            {openSchedule ? (
              <div className="yd-sim__schedule">
                <p className="yd-sim__schedule-note">
                  {`Les ${result.rows.length} échéances de ce crédit ne sont pas affichées d'un bloc : le tableau en montre une année à la fois. Le graphique ci-dessus est la vue d'ensemble, et l'export CSV donne les totaux année par année.`}
                </p>
                <SimSelect
                  id={fieldId("year")}
                  label="Année affichée"
                  value={String(shownYear)}
                  onChange={(value) => setShownYear(Number(value))}
                >
                  {result.years.map((year) => (
                    <option key={year.year} value={year.year}>
                      {`An ${year.year}`}
                    </option>
                  ))}
                </SimSelect>
                {/* Its own scroller: at 375px five money columns do not fit, and
                    the page body must never be what scrolls sideways. */}
                <div className="yd-sim__scroller">
                  <table className="yd-sim__table" data-testid="yd-credit-schedule">
                    <thead>
                      <tr>
                        <th scope="col">Mois</th>
                        <th scope="col">Échéance</th>
                        <th scope="col">Intérêts</th>
                        <th scope="col">Capital</th>
                        <th scope="col">Restant dû</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.month}>
                          <th scope="row">{row.month}</th>
                          <td>{formatCents(row.payment_cents)}</td>
                          <td>{formatCents(row.interest_cents)}</td>
                          <td>{formatCents(row.principal_cents)}</td>
                          <td>{formatCents(row.remaining_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </ResultShell>
    </div>
  );
}
