import { useEffect, useId, useState, type FormEvent } from "react";

import { AmortizationChart, rollUpScheduleYears } from "../../charts/AmortizationChart";
import { EmptyState } from "../../design/EmptyState";
import { formatCents, formatRateBps, parseCents } from "../../design/theme";
import { api } from "../../lib/api";
import { plural } from "../../lib/plural";
import { messageFor, refusalReason } from "../../lib/refusal";
import type { PropertyRequest, PropertySimulation, SimulatorContext } from "../../lib/types";
import {
  Figure,
  MAX_AMOUNT_CENTS,
  MAX_RATE_BPS,
  ResultShell,
  SimField,
  SimSelect,
  bpsToInput,
  parseBps,
  parseCount,
  yearsHint,
  type Errors,
} from "./fields";

/** `engines/amortization.HCSF_DEBT_RATIO_BPS`. A published regulatory
 *  threshold, not a tuned constant, and design §6.3 item 5 names it. */
const HCSF_DEBT_RATIO_BPS = 3_500;

/** `engines/property.NOTARY_BPS_EXISTING` / `NOTARY_BPS_NEW`, and the escape
 *  hatch for a quote that says something else. Ordres de grandeur, adjustable —
 *  never a figure Yieldo insists on. */
const NOTARY_CHOICES = [
  { value: "750", label: "Ancien (7,50 %)" },
  { value: "250", label: "Neuf (2,50 %)" },
  { value: "custom", label: "Autre taux" },
] as const;

/** `schemas/simulators.PropertyIn`'s own bounds, mirrored so the field says no
 *  in French before Pydantic says it in English. `loan_months` is deliberately
 *  NOT here: the engine owns that refusal (see `fields.ts`). */
const MAX_NOTARY_BPS = 10_000;
const MAX_INSURANCE_BPS = 10_000;
const MAX_RETURN_BPS = 3_000;
const MAX_APPRECIATION_BPS = 10_000;
const MAX_COMPARISON_YEARS = 50;
const MAX_TYPED_MONTHS = 9_999;

/**
 * "Et si j'achetais ?" — what a French purchase really costs each month, and
 * whether renting would have left you better off.
 *
 * Three things the screen refuses to blur:
 *
 * * **the frais de notaire are part of what is borrowed.** The acquisition
 *   block adds them to the price and subtracts the apport, in that order, so a
 *   reader can see where 262 500 € came from out of a 300 000 € purchase;
 * * **the debt ratio is MEASURED, never typed.** The income behind it comes
 *   from `GET /api/simulators/context` and is shown with its sample size. When
 *   it could not be measured there is no ratio, and the panel says so — a
 *   "0 %" would read as a household with no debt at all;
 * * **the rent comparison exists only when a rent was entered.** No rent means
 *   no comparison, not a comparison against a rent of zero.
 */
export function PropertySimulator() {
  const baseId = useId();

  const [price, setPrice] = useState("300000,00");
  const [down, setDown] = useState("60000,00");
  const [notaryChoice, setNotaryChoice] = useState<string>("750");
  const [notaryCustom, setNotaryCustom] = useState("7,50");
  const [charges, setCharges] = useState("150,00");
  const [tax, setTax] = useState("1200,00");

  const [loanRate, setLoanRate] = useState("3,50");
  const [loanMonths, setLoanMonths] = useState("240");
  const [insurance, setInsurance] = useState("0,36");

  const [openRent, setOpenRent] = useState(false);
  const [rent, setRent] = useState("");
  const [years, setYears] = useState("10");
  const [appreciation, setAppreciation] = useState("1,00");
  const [annualReturn, setAnnualReturn] = useState("3,00");

  const [errors, setErrors] = useState<Errors>({});
  const [result, setResult] = useState<PropertySimulation | null>(null);
  // The request that produced `result`. `PropertyOut` echoes the measured
  // income and the existing instalments, but NOT the appreciation and return
  // rates the comparison was run under — and design §10 wants those printed
  // beside the verdict they produced. Read from here, never from the live form
  // fields, which the user may have edited since pressing the button.
  const [asked, setAsked] = useState<PropertyRequest | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // What the screen can say about the debt ratio BEFORE anything is submitted.
  // The answer echoes the same figures back, so the panel below reads them from
  // the result once there is one.
  const [context, setContext] = useState<SimulatorContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const body = await api.get<SimulatorContext>("/simulators/context");
        if (!cancelled) setContext(body);
      } catch {
        // The measured income is a caption on one panel, not the answer: a
        // failure to fetch it must not blank the simulator. The panel falls
        // back to the figures the POST itself echoes, which come from the same
        // measurement — and says so rather than showing a blank.
        if (!cancelled) setContext(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const fieldId = (name: string) => `${baseId}-${name}`;

  function clearError(name: string) {
    setErrors((current) => {
      if (current[name] === undefined) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function rateError(
    bps: number | null,
    max: number,
  ): string | undefined {
    if (bps === null || bps < 0 || bps > max) {
      return `Taux illisible : un pourcentage entre 0,00 et ${bpsToInput(max)}.`;
    }
    return undefined;
  }

  function validate(): { request: PropertyRequest } | { errors: Errors } {
    const found: Errors = {};

    const priceCents = parseCents(price);
    if (priceCents === null) {
      found.price = "Montant illisible : saisissez un prix en euros, par exemple 300 000,00.";
    } else if (priceCents <= 0) {
      found.price =
        "Le prix du bien doit être strictement positif : un bien à 0 € ne se finance pas.";
    } else if (priceCents > MAX_AMOUNT_CENTS) {
      found.price = `Montant hors limites : ce simulateur s'arrête à ${formatCents(MAX_AMOUNT_CENTS)}.`;
    }

    const downText = down.trim();
    const downCents = downText.length === 0 ? 0 : parseCents(downText);
    if (downCents === null) {
      found.down = "Montant illisible : saisissez un apport en euros, par exemple 60 000,00.";
    } else if (downCents < 0) {
      found.down = "L'apport ne peut pas être négatif : c'est une somme détenue.";
    }

    const notaryBps =
      notaryChoice === "custom" ? parseBps(notaryCustom) : Number(notaryChoice);
    const notaryProblem = rateError(notaryBps, MAX_NOTARY_BPS);
    if (notaryProblem !== undefined) found.notary = notaryProblem;

    const chargesText = charges.trim();
    const chargesCents = chargesText.length === 0 ? 0 : parseCents(chargesText);
    if (chargesCents === null || chargesCents < 0) {
      found.charges = "Montant illisible : des charges mensuelles en euros, par exemple 150,00.";
    }

    const taxText = tax.trim();
    const taxCents = taxText.length === 0 ? 0 : parseCents(taxText);
    if (taxCents === null || taxCents < 0) {
      found.tax = "Montant illisible : une taxe foncière annuelle en euros, par exemple 1 200,00.";
    }

    const loanRateBps = parseBps(loanRate);
    const loanRateProblem = rateError(loanRateBps, MAX_RATE_BPS);
    if (loanRateProblem !== undefined) found.loanRate = loanRateProblem;

    const term = parseCount(loanMonths, 0, MAX_TYPED_MONTHS);
    if (term === null) {
      found.loanMonths = "Durée illisible : saisissez un nombre entier de mois, par exemple 240.";
    }

    const insuranceBps = parseBps(insurance);
    const insuranceProblem = rateError(insuranceBps, MAX_INSURANCE_BPS);
    if (insuranceProblem !== undefined) found.insurance = insuranceProblem;

    // The comparison's four fields are validated ONLY when a rent was typed:
    // an untouched, collapsed group must not be able to refuse a purchase the
    // user did ask about.
    const rentText = rent.trim();
    const wantsComparison = openRent && rentText.length > 0;
    let rentCents: number | null = null;
    let horizonYears: number | null = null;
    let appreciationBps: number | null = null;
    let returnBps: number | null = null;
    if (wantsComparison) {
      rentCents = parseCents(rentText);
      if (rentCents === null || rentCents < 0) {
        found.rent = "Montant illisible : un loyer mensuel en euros, par exemple 1 100,00.";
      }
      horizonYears = parseCount(years, 1, MAX_COMPARISON_YEARS);
      if (horizonYears === null) {
        found.years = `Durée illisible : un nombre entier d'années, entre 1 et ${MAX_COMPARISON_YEARS}.`;
      }
      appreciationBps = parseBps(appreciation);
      const appreciationProblem = rateError(appreciationBps, MAX_APPRECIATION_BPS);
      if (appreciationProblem !== undefined) found.appreciation = appreciationProblem;
      returnBps = parseBps(annualReturn);
      const returnProblem = rateError(returnBps, MAX_RETURN_BPS);
      if (returnProblem !== undefined) found.return = returnProblem;
    }

    if (Object.keys(found).length > 0) return { errors: found };

    const request: PropertyRequest = {
      price_cents: priceCents as number,
      down_payment_cents: downCents as number,
      notary_bps: notaryBps as number,
      loan_rate_bps: loanRateBps as number,
      loan_months: term as number,
      insurance_bps_per_year: insuranceBps as number,
      monthly_charges_cents: chargesCents as number,
      annual_property_tax_cents: taxCents as number,
    };
    // Omitted, never zeroed: an absent rent must reach the engine as absent, so
    // `rent_comparison` comes back null and the screen says what to type
    // instead of comparing against a rent of nothing.
    if (wantsComparison) {
      request.monthly_rent_cents = rentCents as number;
      request.years = horizonYears as number;
      request.annual_return_bps = returnBps as number;
      request.appreciation_bps_per_year = appreciationBps as number;
    }
    return { request };
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
      setResult(await api.post<PropertySimulation>("/simulators/immobilier", checked.request));
      setAsked(checked.request);
    } catch (err) {
      const reason = refusalReason(err);
      setResult(null);
      setAsked(null);
      if (reason !== null) setRefusal(reason);
      else setFailure(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const simulation = result?.simulation ?? null;
  const comparison = result?.rent_comparison ?? null;
  const income = result?.measured_monthly_income_cents ?? context?.monthly_income_cents ?? null;
  const monthsObserved = context?.months_observed ?? null;

  return (
    <div className="yd-sim">
      <form className="yd-sim__form" onSubmit={submit} noValidate>
        <fieldset className="yd-prop__group">
          <legend>Le bien</legend>
          <div className="yd-sim__grid">
            <SimField
              id={fieldId("price")}
              label="Prix du bien (€)"
              value={price}
              onChange={(text) => {
                setPrice(text);
                clearError("price");
              }}
              error={errors.price}
              placeholder="300 000,00"
            />
            <SimField
              id={fieldId("down")}
              label="Apport disponible (€)"
              value={down}
              onChange={(text) => {
                setDown(text);
                clearError("down");
              }}
              error={errors.down}
              placeholder="60 000,00"
              hint="Une banque française attend en général qu'il couvre au moins les frais de notaire."
            />
            <SimSelect
              id={fieldId("notary")}
              label="Frais de notaire"
              value={notaryChoice}
              onChange={(value) => {
                setNotaryChoice(value);
                clearError("notary");
              }}
              hint="Ordres de grandeur français, à remplacer par le chiffre de votre notaire."
            >
              {NOTARY_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </SimSelect>
            {notaryChoice === "custom" ? (
              <SimField
                id={fieldId("notaryCustom")}
                label="Taux de frais de notaire (%)"
                kind="rate"
                value={notaryCustom}
                onChange={(text) => {
                  setNotaryCustom(text);
                  clearError("notary");
                }}
                error={errors.notary}
                placeholder="7,50"
              />
            ) : null}
            <SimField
              id={fieldId("charges")}
              label="Charges mensuelles (€)"
              value={charges}
              onChange={(text) => {
                setCharges(text);
                clearError("charges");
              }}
              error={errors.charges}
              placeholder="150,00"
              hint="Copropriété, entretien. Payées par un propriétaire comme par un locataire."
            />
            <SimField
              id={fieldId("tax")}
              label="Taxe foncière annuelle (€)"
              value={tax}
              onChange={(text) => {
                setTax(text);
                clearError("tax");
              }}
              error={errors.tax}
              placeholder="1 200,00"
            />
          </div>
        </fieldset>

        <fieldset className="yd-prop__group">
          <legend>Le crédit</legend>
          <div className="yd-sim__grid">
            <SimField
              id={fieldId("loanRate")}
              label="Taux du crédit (%)"
              kind="rate"
              value={loanRate}
              onChange={(text) => {
                setLoanRate(text);
                clearError("loanRate");
              }}
              error={errors.loanRate}
              placeholder="3,50"
              hint="Taux nominal, hors assurance."
            />
            <SimField
              id={fieldId("loanMonths")}
              label="Durée du crédit (mois)"
              kind="count"
              value={loanMonths}
              onChange={(text) => {
                setLoanMonths(text);
                clearError("loanMonths");
              }}
              error={errors.loanMonths}
              hint={yearsHint(loanMonths) || null}
            />
            <SimField
              id={fieldId("insurance")}
              label="Assurance emprunteur (% par an)"
              kind="rate"
              value={insurance}
              onChange={(text) => {
                setInsurance(text);
                clearError("insurance");
              }}
              error={errors.insurance}
              placeholder="0,36"
              hint="Sur le capital initial, la convention française. Elle compte dans le taux d'endettement."
            />
          </div>
        </fieldset>

        <div className="yd-sim__disclosure">
          <button
            type="button"
            className="yd-sim__toggle"
            aria-expanded={openRent}
            onClick={() => setOpenRent((open) => !open)}
          >
            {`Comparer avec la location (${openRent ? "masquer" : "ouvrir"})`}
          </button>
        </div>

        {openRent ? (
          <fieldset className="yd-prop__group">
            <legend>Comparer avec la location</legend>
            <div className="yd-sim__grid">
              <SimField
                id={fieldId("rent")}
                label="Loyer mensuel (€)"
                value={rent}
                onChange={(text) => {
                  setRent(text);
                  clearError("rent");
                }}
                error={errors.rent}
                placeholder="1 100,00"
                hint="Le loyer d'un bien équivalent. Sans lui, aucune comparaison n'est calculée."
              />
              <SimField
                id={fieldId("years")}
                label="Horizon de comparaison (années)"
                kind="count"
                value={years}
                onChange={(text) => {
                  setYears(text);
                  clearError("years");
                }}
                error={errors.years}
              />
              <SimField
                id={fieldId("appreciation")}
                label="Revalorisation du bien (% par an)"
                kind="rate"
                value={appreciation}
                onChange={(text) => {
                  setAppreciation(text);
                  clearError("appreciation");
                }}
                error={errors.appreciation}
                placeholder="1,00"
              />
              <SimField
                id={fieldId("return")}
                label="Rendement du placement (% par an)"
                kind="rate"
                value={annualReturn}
                onChange={(text) => {
                  setAnnualReturn(text);
                  clearError("return");
                }}
                error={errors.return}
                placeholder="3,00"
              />
            </div>
            <p className="yd-sim__assumptions">
              Ces deux taux sont des hypothèses que vous choisissez, pas des mesures et pas des
              prévisions : Yieldo ne connaît ni le marché immobilier de votre ville, ni le
              rendement de vos placements.
            </p>
          </fieldset>
        ) : null}

        <button type="submit" className="yd-sim__submit" disabled={busy}>
          {busy ? "Calcul en cours…" : "Calculer l'achat"}
        </button>
      </form>

      <ResultShell
        busy={busy}
        failure={failure}
        refusal={refusal}
        empty={
          <EmptyState
            title="Aucun achat simulé."
            detail="Renseignez un prix, un apport et les conditions du crédit. Les frais de notaire sont ajoutés au prix avant de retirer l'apport : c'est ce total-là qui est emprunté."
          />
        }
      >
        {simulation === null || result === null ? null : (
          <div className="yd-sim__result">
            {/* -- What is bought, and what is borrowed ------------------- */}
            <div className="yd-prop__breakdown" data-testid="yd-prop-acquisition">
              <h3 className="yd-prop__title">Ce que vous achetez</h3>
              <dl className="yd-prop__lines">
                <div className="yd-prop__line">
                  <dt>Prix du bien</dt>
                  <dd>{formatCents(simulation.price_cents)}</dd>
                </div>
                <div className="yd-prop__line">
                  <dt>Frais de notaire</dt>
                  <dd>{formatCents(simulation.notary_fees_cents)}</dd>
                </div>
                <div className="yd-prop__line yd-prop__line--total">
                  <dt>Coût d'acquisition</dt>
                  <dd>{formatCents(simulation.acquisition_cost_cents)}</dd>
                </div>
                <div className="yd-prop__line">
                  <dt>Apport</dt>
                  <dd>{`− ${formatCents(simulation.down_payment_cents)}`}</dd>
                </div>
                <div className="yd-prop__line yd-prop__line--total">
                  <dt>Emprunté</dt>
                  <dd>{formatCents(simulation.borrowed_cents)}</dd>
                </div>
              </dl>
              <p className="yd-prop__note">
                Les frais de notaire sont ajoutés au prix AVANT de retirer l'apport : c'est ce
                total qui est financé. Calculer la mensualité sur le seul prix du bien la
                sous-estimerait de celle des frais.
              </p>
            </div>

            {simulation.down_payment_short_cents > 0 ? (
              <p className="yd-sim__consequence" data-testid="yd-prop-short">
                {`Votre apport ne couvre pas les frais de notaire : il en manque ${formatCents(simulation.down_payment_short_cents)}. Une banque française demande en général que ces frais soient payés sur fonds propres. Ce n'est pas un refus de calcul — la simulation ci-dessous les finance — mais c'est un point sur lequel votre dossier sera regardé.`}
              </p>
            ) : null}

            {/* -- What it costs every month ------------------------------ */}
            <div className="yd-prop__breakdown" data-testid="yd-prop-effort">
              <h3 className="yd-prop__title">Ce que ça coûte chaque mois</h3>
              <dl className="yd-prop__lines">
                <div className="yd-prop__line">
                  <dt>Mensualité du crédit</dt>
                  <dd>{formatCents(simulation.schedule.monthly_payment_cents)}</dd>
                </div>
                <div className="yd-prop__line">
                  <dt>Assurance emprunteur</dt>
                  <dd>{formatCents(simulation.monthly_insurance_cents)}</dd>
                </div>
                <div className="yd-prop__line">
                  <dt>Charges</dt>
                  <dd>{formatCents(simulation.monthly_charges_cents)}</dd>
                </div>
                <div className="yd-prop__line">
                  <dt>Taxe foncière, mensualisée</dt>
                  <dd>{formatCents(simulation.monthly_property_tax_cents)}</dd>
                </div>
                <div
                  className="yd-prop__line yd-prop__line--total"
                  data-testid="yd-prop-effort-total"
                >
                  <dt>Effort mensuel</dt>
                  <dd>{formatCents(simulation.monthly_effort_cents)}</dd>
                </div>
              </dl>
            </div>

            {/* -- The debt ratio. NULL FIRST. --------------------------- */}
            <div
              className={`yd-prop__ratio${
                simulation.debt_ratio_bps !== null && simulation.debt_ratio_exceeded
                  ? " yd-prop__ratio--exceeded"
                  : ""
              }`}
              data-testid="yd-prop-ratio"
            >
              <span className="yd-prop__ratio-label">Taux d'endettement</span>
              {simulation.debt_ratio_bps === null ? (
                // `debt_ratio_exceeded` is false BOTH under the threshold and
                // when there is no ratio at all, and cannot tell the two apart.
                // Read the null first, always.
                <p className="yd-prop__ratio-words">
                  Votre taux d'endettement n'a pas pu être calculé : il faut au moins trois mois
                  complets de relevés pour mesurer un revenu, et sans revenu mesuré il n'y a pas
                  de taux. Rien n'est affiché à sa place — un « 0 % » se lirait comme un ménage
                  sans aucune charge.
                </p>
              ) : (
                <>
                  <span className="yd-prop__ratio-value">
                    {formatRateBps(simulation.debt_ratio_bps)}
                  </span>
                  <p className="yd-prop__ratio-note">
                    {simulation.debt_ratio_exceeded
                      ? `Au-delà du seuil de ${formatRateBps(HCSF_DEBT_RATIO_BPS)} fixé par le HCSF, une banque française refuse le dossier sauf dérogation. Le chiffre n'est pas plafonné à ce seuil : c'est bien celui que ce plan produit.`
                      : `Sous le seuil de ${formatRateBps(HCSF_DEBT_RATIO_BPS)} fixé par le HCSF. Mensualité et assurance comprises, comme une banque française les compte.`}
                  </p>
                  <p className="yd-prop__ratio-source">
                    {income === null
                      ? "Calculé sur un revenu mesuré dans vos relevés."
                      : `Calculé sur ${formatCents(income)} de revenu mensuel mesuré dans vos relevés${
                          monthsObserved === null
                            ? ""
                            : `, sur ${monthsObserved} ${plural(monthsObserved, "mois complet", "mois complets")}`
                        }, et sur ${formatCents(result.existing_debt_payments_cents)} de mensualités déjà engagées. Ce revenu ne se saisit pas : il est mesuré.`}
                  </p>
                </>
              )}
            </div>

            <div className="yd-sim__figures">
              <Figure
                testId="yd-prop-interest"
                label="Intérêts du crédit"
                value={formatCents(simulation.total_interest_cents)}
                note={`Sur ${simulation.schedule.months} mois, au taux saisi.`}
              />
              <Figure
                testId="yd-prop-total"
                lead
                label="Coût total"
                value={formatCents(simulation.total_cost_cents)}
                note="Acquisition, intérêts et assurance réunis. Les charges et la taxe foncière n'y sont pas : un locataire les paie aussi, sous un autre nom."
              />
              <Figure
                testId="yd-prop-borrowed"
                label="Capital emprunté"
                value={formatCents(simulation.borrowed_cents)}
                note={`Prix et frais de notaire, moins ${formatCents(simulation.down_payment_cents)} d'apport.`}
              />
            </div>

            <AmortizationChart
              years={rollUpScheduleYears(simulation.schedule.rows)}
              months={simulation.schedule.months}
              totalInterestCents={simulation.total_interest_cents}
            />

            {/* -- Renting against buying -------------------------------- */}
            {comparison === null ? (
              <p className="yd-sim__assumptions" data-testid="yd-prop-no-comparison">
                Aucune comparaison avec la location n'a été calculée : ouvrez « Comparer avec la
                location » ci-dessus et saisissez un loyer mensuel. Sans loyer, il n'y a rien à
                comparer — et comparer contre un loyer de zéro donnerait une réponse fausse plutôt
                qu'aucune réponse.
              </p>
            ) : (
              <div className="yd-prop__comparison" data-testid="yd-prop-comparison">
                <h3 className="yd-prop__title">Acheter ou louer</h3>
                {comparison.capped_reason !== null ? (
                  // Verbatim. The sentence explains WHY the horizon was cut
                  // back, and a paraphrase loses the reason.
                  <p className="yd-prop__capped">{comparison.capped_reason}</p>
                ) : null}
                <div className="yd-prop__sides">
                  <div className="yd-prop__side">
                    <span className="yd-prop__side-label">Patrimoine en achetant</span>
                    <span className="yd-prop__side-value">
                      {formatCents(comparison.buyer_wealth_cents, { signed: true })}
                    </span>
                    <span className="yd-prop__side-note">
                      {`${formatCents(comparison.buyer_property_value_cents)} de bien, moins ${formatCents(comparison.buyer_remaining_loan_cents)} de capital restant dû.`}
                    </span>
                  </div>
                  <div className="yd-prop__side">
                    <span className="yd-prop__side-label">Patrimoine en louant</span>
                    <span className="yd-prop__side-value">
                      {formatCents(comparison.renter_wealth_cents, { signed: true })}
                    </span>
                    <span className="yd-prop__side-note">
                      {`L'apport et les frais de notaire placés, plus l'écart entre l'effort du propriétaire et un loyer de ${formatCents(comparison.monthly_rent_cents)}.`}
                    </span>
                  </div>
                </div>
                {/* Design §10: the verdict and the three hypotheses that
                    produced it, in ONE paragraph, so the answer cannot be read
                    without them. The rates come from `asked` — the request that
                    actually produced this answer — and never from the live form
                    fields, which the user may have edited since. */}
                <p className="yd-prop__verdict" data-testid="yd-prop-verdict">
                  <span className="yd-prop__verdict-value">
                    {comparison.better_kind === "rent"
                      ? "Louer et placer la différence"
                      : "Acheter"}
                  </span>
                  {` laisse ${formatCents(Math.abs(comparison.difference_cents))} de plus au bout de ${comparison.horizon_months} mois — sous trois hypothèses que vous avez choisies et qui décident du résultat : le bien revalorisé de ${formatRateBps(asked?.appreciation_bps_per_year ?? 0)} par an, le placement rémunéré à ${formatRateBps(asked?.annual_return_bps ?? 0)} par an, et cet horizon de ${comparison.horizon_months} mois. Changez l'une des trois et le gagnant peut changer.`}
                </p>
              </div>
            )}
          </div>
        )}
      </ResultShell>
    </div>
  );
}
