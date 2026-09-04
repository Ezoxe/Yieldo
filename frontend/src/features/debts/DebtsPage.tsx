import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { DebtPayoffChart } from "../../charts/DebtPayoffChart";
import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { EmptyState, frenchDate } from "../../design/EmptyState";
import { ArchiveIcon, DebtsIcon, EditIcon, PlusIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { formatCents, formatRateBps, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { Debt, PayoffPlan, StrategyComparison } from "../../lib/types";
import { DEBT_KINDS, DebtForm } from "./DebtForm";
import "./DebtsPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** Long enough that a three-digit amount is typed before the first request
 *  leaves, short enough that the recomputation feels like a response. */
const EXTRA_DEBOUNCE_MS = 350;

type Strategy = "snowball" | "avalanche";

const STRATEGY_LABEL: Record<Strategy, string> = {
  snowball: "Boule de neige",
  avalanche: "Avalanche",
};

const STRATEGY_RULE: Record<Strategy, string> = {
  snowball: "Le plus petit capital d'abord : une dette disparaît le plus tôt possible.",
  avalanche: "Le taux le plus élevé d'abord : c'est l'ordre le moins cher en intérêts.",
};

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

function kindLabel(kind: string): string {
  return DEBT_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

/**
 * The same duration in years, as a second quieter line — "soit 4 ans et 4 mois".
 * Null under a year, where it would only repeat the figure above it.
 *
 * Kept out of the headline figure on purpose: measured at 1440, "52 mois (4 ans
 * et 4 mois)" wrapped onto two lines of the mono display face, which put a
 * French sentence in a number's typography and made the panel read as a
 * paragraph. "mois" is invariant in French, so only the years take a plural.
 */
function yearsNote(months: number): string | null {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return null;
  if (rest === 0) return `soit ${years} ${plural(years, "an", "ans")} tout juste`;
  return `soit ${years} ${plural(years, "an", "ans")} et ${rest} mois`;
}

/**
 * What choosing avalanche over snowball actually buys — or does not.
 *
 * `interest_saved_cents` is snowball's interest minus avalanche's. It is
 * **null** when either plan refused (a difference between a number and a
 * refusal is not a saving), **0** on a single debt or on two at the same rate,
 * and it can be **negative**: rounding each month's interest to the cent is
 * enough to erase the theoretical gap, and on rare inputs to put avalanche a
 * cent behind. `test_avalanche_can_tie_or_trail_by_a_cent` pins one in the
 * backend. "Vous économisez −0,01 €" is not an answer, so each case gets its
 * own sentence.
 */
export function savingSentence(interestSaved: number, monthsSaved: number): string {
  const timing =
    monthsSaved > 0
      ? ` et vous solde ${monthsSaved} mois plus tôt.`
      : monthsSaved < 0
        ? `, mais vous solde ${Math.abs(monthsSaved)} mois plus tard.`
        : ", sans changer la date de solde.";

  if (interestSaved > 0) {
    return `Choisir l'avalanche plutôt que la boule de neige vous coûte ${formatCents(interestSaved)} de moins en intérêts${timing}`;
  }
  if (interestSaved < 0) {
    return (
      `Sur ces montants, l'avalanche coûte ${formatCents(Math.abs(interestSaved))} d'intérêts de plus que la boule de neige${timing} ` +
      "L'écart théorique entre les deux ordres est plus petit que l'arrondi au centime appliqué à chaque mois d'intérêts."
    );
  }
  return `Ici, les deux stratégies coûtent exactement la même chose en intérêts${timing}`;
}

/** The shortfall behind a budget refusal, in euros. `monthly_budget_cents` and
 *  `first_month_interest_cents` are published by the engine precisely so this
 *  sentence does not have to recompute anything. */
function shortfallSentence(plan: PayoffPlan): string {
  const gap = plan.first_month_interest_cents - plan.monthly_budget_cents;
  return (
    `Les mensualités réunies pèsent ${formatCents(plan.monthly_budget_cents)} par mois, ` +
    `quand les intérêts du premier mois s'élèvent déjà à ${formatCents(plan.first_month_interest_cents)}` +
    (gap > 0 ? ` : il en manque ${formatCents(gap)} rien que pour stabiliser le capital.` : ".")
  );
}

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the same cells at the same spans and nothing
 * moves when the data arrives.
 *
 * At lg (12 columns): the declared debts beside the two strategies, then the
 * payoff curve full width underneath. The strategies cell is the wider of the
 * two — it holds two panels side by side plus everything qualifying them.
 */
const SPAN = {
  debts: { base: 1, md: 6, lg: 5 },
  plan: { base: 1, md: 6, lg: 7 },
  chart: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

interface LoadErrors {
  debts?: string;
  payoff?: string;
}

export function DebtsPage() {
  const reduced = useReducedMotion();
  const extraFieldId = useId();

  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [comparison, setComparison] = useState<StrategyComparison | null>(null);
  const [errors, setErrors] = useState<LoadErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [extraText, setExtraText] = useState("0");
  const [extraError, setExtraError] = useState<string | null>(null);
  const [extraCents, setExtraCents] = useState(0);

  const [strategy, setStrategy] = useState<Strategy>("avalanche");
  const [editing, setEditing] = useState<Debt | "new" | null>(null);
  const [pendingArchive, setPendingArchive] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const firstLoad = useRef(true);

  // The typed euro amount, debounced into the integer cents the query carries.
  // Nothing is asked of the backend on an unreadable or negative value: the
  // route refuses `extra_cents < 0` (`Query(ge=0)`) and the engine refuses it
  // again, but a round trip to be told what the field already knows is not a
  // way to report an input error.
  useEffect(() => {
    const text = extraText.trim();
    if (text === "") {
      setExtraError(null);
      const timer = setTimeout(() => setExtraCents(0), EXTRA_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }
    const cents = parseCents(text);
    if (cents === null) {
      setExtraError("Montant illisible : saisissez un montant en euros, par exemple 50,00.");
      return;
    }
    if (cents < 0) {
      setExtraError(
        "Le versement supplémentaire ne peut pas être négatif : il s'ajoute aux mensualités minimales, il ne les remplace pas.",
      );
      return;
    }
    setExtraError(null);
    const timer = setTimeout(() => setExtraCents(cents), EXTRA_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [extraText]);

  useEffect(() => {
    let cancelled = false;
    if (!firstLoad.current) setRecomputing(true);

    async function load() {
      // `allSettled`, not `all`: the declared list and the computed plan are two
      // independent questions behind two independent routes, and one failing is
      // no reason to blank the other.
      const [debtsResult, payoffResult] = await Promise.allSettled([
        api.get<Debt[]>("/debts"),
        api.get<StrategyComparison>("/debts/payoff", { extra_cents: extraCents }),
      ]);
      if (cancelled) return;

      const nextErrors: LoadErrors = {};
      if (debtsResult.status === "fulfilled") {
        setDebts(debtsResult.value);
      } else {
        setDebts(null);
        nextErrors.debts = messageFor(debtsResult.reason);
      }
      if (payoffResult.status === "fulfilled") {
        setComparison(payoffResult.value);
      } else {
        setComparison(null);
        nextErrors.payoff = messageFor(payoffResult.reason);
      }
      setErrors(nextErrors);
      firstLoad.current = false;
      setIsLoading(false);
      setRecomputing(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [extraCents, reloadToken]);

  const names = useMemo(
    () => new Map((debts ?? []).map((debt) => [debt.id, debt.name] as const)),
    [debts],
  );

  async function archive(debt: Debt) {
    try {
      // DELETE archives rather than deletes: a repaid debt is part of the
      // household's history (api/debts.py).
      await api.delete(`/debts/${debt.id}`);
      setPendingArchive(null);
      setRowError(null);
      setReloadToken((token) => token + 1);
    } catch (err) {
      setRowError(messageFor(err));
    }
  }

  // Keyed and labelled by which half failed, not by the message: a database
  // outage takes both routes down with the same `detail`, which as a bare
  // repeated sentence is a duplicate React key and names neither panel.
  const errorEntries: Array<{ field: string; label: string; message: string }> = [
    { field: "debts", label: "Liste des dettes indisponible", message: errors.debts },
    { field: "payoff", label: "Échéancier indisponible", message: errors.payoff },
  ].filter((entry): entry is { field: string; label: string; message: string } =>
    Boolean(entry.message),
  );

  // `months === 0` with a null reason is the engine's answer for a household
  // with no debts at all -- an answer, not a refusal. Rendering it as "soldé
  // dans 0 mois" would be absurd.
  const noDebts =
    comparison !== null && comparison.snowball.months === 0 && comparison.avalanche.months === 0;

  // Both refusals are shared by construction when the cause is the budget: the
  // budget and the first month's interest do not depend on the attack order.
  // Printing the same paragraph twice, once per panel, says nothing the once
  // does not. A refusal that differs between the two strategies stays inside
  // the panel it belongs to.
  const sharedRefusal =
    comparison !== null &&
    comparison.snowball.unavailable_reason !== null &&
    comparison.snowball.unavailable_reason === comparison.avalanche.unavailable_reason
      ? comparison.snowball.unavailable_reason
      : null;

  const shown = comparison ? comparison[strategy] : null;

  function renderPlanPanel(plan: PayoffPlan, key: Strategy) {
    return (
      <div
        className={`yd-plan${plan.months === null ? " yd-plan--unavailable" : ""}`}
        data-testid={`yd-plan-${key}`}
      >
        <h3 className="yd-plan__label">{STRATEGY_LABEL[key]}</h3>
        <p className="yd-plan__rule">{STRATEGY_RULE[key]}</p>
        {plan.months === null ? (
          <p className="yd-plan__unavailable">{plan.unavailable_reason}</p>
        ) : (
          <>
            <p className="yd-plan__months">{`${plan.months} mois`}</p>
            {yearsNote(plan.months) !== null ? (
              <p className="yd-plan__years">{yearsNote(plan.months)}</p>
            ) : null}
            {plan.cleared_on !== null ? (
              <p className="yd-plan__cleared">{`Tout est soldé le ${frenchDate(plan.cleared_on)}.`}</p>
            ) : null}
            <dl className="yd-plan__figures">
              <div>
                <dt>Intérêts payés</dt>
                <dd>{formatCents(plan.total_interest_cents)}</dd>
              </div>
              <div>
                <dt>Total versé</dt>
                <dd>{formatCents(plan.total_paid_cents)}</dd>
              </div>
            </dl>
            {plan.order.length > 0 ? (
              <>
                <p className="yd-plan__order-label" id={`yd-order-${key}`}>
                  Ordre d'attaque
                </p>
                <ol className="yd-plan__order" aria-labelledby={`yd-order-${key}`}>
                  {plan.order.map((id) => (
                    <li key={id}>{names.get(id) ?? `Dette ${id}`}</li>
                  ))}
                </ol>
              </>
            ) : null}
          </>
        )}
      </div>
    );
  }

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement des dettes">
        <BentoCell span={SPAN.debts} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--debt-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--debt-list" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.plan} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--debt-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--debt-plans" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.chart} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--debt-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--debt-chart" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.debts} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={DebtsIcon}>Vos dettes</PanelHead>

          {debts === null ? null : debts.length === 0 && editing === null ? (
            <EmptyState
              title="Aucune dette enregistrée."
              detail="Yieldo ne peut pas reconnaître un crédit à la consommation dans une ligne de relevé : une mensualité prélevée ressemble à n'importe quel autre virement. Vos dettes se déclarent donc ici, une par une, avec leur capital restant dû, leur taux et leur mensualité."
            >
              <button
                type="button"
                className="yd-empty__action"
                onClick={() => setEditing("new")}
              >
                <PlusIcon />
                Ajouter une dette
              </button>
            </EmptyState>
          ) : (
            <>
              {debts.length > 0 ? (
                <ul className="yd-debts__list">
                  {debts.map((debt) => (
                    <li key={debt.id} className="yd-debts__row">
                      <div className="yd-debts__row-head">
                        <span className="yd-debts__name">{debt.name}</span>
                        <span className="yd-debts__kind">{kindLabel(debt.kind)}</span>
                      </div>
                      <dl className="yd-debts__figures">
                        <div>
                          <dt>Capital restant dû</dt>
                          <dd>{formatCents(debt.principal_cents)}</dd>
                        </div>
                        <div>
                          <dt>Taux annuel</dt>
                          <dd>{formatRateBps(debt.annual_rate_bps)}</dd>
                        </div>
                        <div>
                          <dt>Mensualité</dt>
                          <dd>{formatCents(debt.minimum_payment_cents)}</dd>
                        </div>
                      </dl>
                      {pendingArchive === debt.id ? (
                        <div className="yd-debts__row-actions">
                          <span className="yd-debts__confirm">
                            {`Archiver « ${debt.name} » ? Elle sortira de l'échéancier ; son historique est conservé.`}
                          </span>
                          <button
                            type="button"
                            className="yd-debts__action yd-debts__action--danger"
                            onClick={() => void archive(debt)}
                          >
                            Confirmer
                          </button>
                          <button
                            type="button"
                            className="yd-debts__action"
                            onClick={() => setPendingArchive(null)}
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <div className="yd-debts__row-actions">
                          {/* The debt's name lives in the accessible name, not
                              in the visible label: a screen reader hears which
                              row it is on, and the button stays a button rather
                              than a sentence. Same shape as BudgetsPage's
                              "Définir". */}
                          <button
                            type="button"
                            className="yd-debts__action"
                            onClick={() => setEditing(debt)}
                          >
                            <span className="sr-only">{`Modifier ${debt.name}`}</span>
                            <EditIcon />
                            <span aria-hidden="true">Modifier</span>
                          </button>
                          <button
                            type="button"
                            className="yd-debts__action"
                            onClick={() => setPendingArchive(debt.id)}
                          >
                            <span className="sr-only">{`Archiver ${debt.name}`}</span>
                            <ArchiveIcon />
                            <span aria-hidden="true">Archiver</span>
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              {rowError !== null ? (
                <p role="alert" className="yd-debts__alert">
                  {rowError}
                </p>
              ) : null}

              {editing === null ? (
                <button
                  type="button"
                  className="yd-debts__add"
                  onClick={() => setEditing("new")}
                >
                  <PlusIcon />
                  Ajouter une dette
                </button>
              ) : null}
            </>
          )}

          {editing !== null ? (
            <DebtForm
              key={editing === "new" ? "new" : editing.id}
              debt={editing === "new" ? undefined : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                setReloadToken((token) => token + 1);
              }}
            />
          ) : null}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.plan}
          className="yd-panel"
          aria-busy={recomputing || undefined}
          {...entryProps(reduced)}
        >
          <PanelHead icon={DebtsIcon}>Deux façons de rembourser</PanelHead>

          {comparison === null ? null : noDebts ? (
            <p className="yd-debts__none">
              Aucune dette à rembourser : il n'y a pas d'échéancier à établir. Déclarez une dette
              pour comparer la boule de neige et l'avalanche.
            </p>
          ) : (
            <>
              <p className="yd-debts__caption">
                {`Les deux plans versent la même somme chaque mois : ${formatCents(comparison.snowball.monthly_budget_cents)}, soit toutes vos mensualités minimales plus le versement supplémentaire ci-dessous. Quand une dette est soldée, sa mensualité passe à la suivante — le budget ne baisse jamais.`}
              </p>

              <div className="yd-debts__extra">
                <label htmlFor={extraFieldId}>Versement mensuel supplémentaire (€)</label>
                <input
                  id={extraFieldId}
                  type="text"
                  inputMode="decimal"
                  value={extraText}
                  aria-invalid={extraError !== null}
                  aria-describedby={extraError !== null ? `${extraFieldId}-error` : undefined}
                  onChange={(event) => setExtraText(event.target.value)}
                  placeholder="0,00"
                />
                {extraError !== null ? (
                  <p id={`${extraFieldId}-error`} role="alert" className="yd-debts__field-error">
                    {extraError}
                  </p>
                ) : null}
                {/* A visible busy state, not only `aria-busy`: a period change
                    that silently kept the old figures on screen was phase 2A's
                    most visible deferral. */}
                {recomputing ? (
                  <p className="yd-debts__busy">
                    <span className="yd-debts__spinner" aria-hidden="true" />
                    Recalcul de l'échéancier…
                  </p>
                ) : null}
              </div>

              {sharedRefusal !== null ? (
                <>
                  {/* The engine's own sentence, verbatim: it names WHICH of two
                      distinct causes applies. Rendered in the panel's
                      explanatory style, never in the negative alert reserved
                      for something having gone wrong. */}
                  <p className="yd-debts__unavailable">{sharedRefusal}</p>
                  <p className="yd-debts__note" data-testid="yd-debts-shortfall">
                    {shortfallSentence(comparison.snowball)}
                  </p>
                </>
              ) : (
                <>
                  <div className={`yd-debts__plans${recomputing ? " yd-debts__plans--busy" : ""}`}>
                    {renderPlanPanel(comparison.snowball, "snowball")}
                    {renderPlanPanel(comparison.avalanche, "avalanche")}
                  </div>

                  {comparison.interest_saved_cents !== null &&
                  comparison.months_saved !== null ? (
                    <p className="yd-debts__saving">
                      {savingSentence(comparison.interest_saved_cents, comparison.months_saved)}
                    </p>
                  ) : (
                    // Never a saving computed against a refusal: the difference
                    // between a number and a refusal is not a gain.
                    <p className="yd-debts__note">
                      L'écart entre les deux stratégies n'est pas chiffré : l'une des deux n'a pas
                      d'échéancier.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </BentoCell>

        {/* No cell at all when there is nothing owed: a card carrying a title
            and an empty body reads as something having failed to load, which is
            the opposite of what an empty state is for. */}
        {shown === null || noDebts ? null : (
        <BentoCell as={motion.div} span={SPAN.chart} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={DebtsIcon}>Capital restant dû, mois après mois</PanelHead>
          {shown.months === null || shown.points.length === 0 ? (
            <p className="yd-debts__note">
              Aucune courbe à tracer : aucun échéancier n'a pu être établi. La raison est donnée
              avec les stratégies, sous « Deux façons de rembourser ».
            </p>
          ) : (
            <>
              <fieldset className="yd-debts__strategy">
                <legend>Échéancier affiché</legend>
                {(["snowball", "avalanche"] as const).map((key) => (
                  <label key={key} className="yd-debts__strategy-option">
                    <input
                      type="radio"
                      name="yd-debts-strategy"
                      value={key}
                      checked={strategy === key}
                      onChange={() => setStrategy(key)}
                    />
                    <span>{STRATEGY_LABEL[key]}</span>
                  </label>
                ))}
              </fieldset>
              <DebtPayoffChart points={shown.points} names={names} />
              <p className="yd-debts__note">
                Une bande par dette, empilées : la hauteur totale est ce qu'il reste à rembourser.
                Une bande qui disparaît est une dette soldée, et sa mensualité passe alors à la
                suivante.
              </p>
            </>
          )}
        </BentoCell>
        )}
      </BentoGrid>
    );
  }

  return (
    <section className="yd-debts">
      <PageHead icon={DebtsIcon} title="Dettes" className="yd-debts__header">

        <p className="yd-debts__lead">
          Ce que vous devez, dans quel ordre le rembourser, et ce que le choix de l'ordre coûte ou
          rapporte.
        </p>
      </PageHead>

      {errorEntries.map((entry) => (
        <p role="alert" className="yd-debts__alert" key={entry.field}>
          {`${entry.label} : ${entry.message}`}
        </p>
      ))}

      {body}
    </section>
  );
}
