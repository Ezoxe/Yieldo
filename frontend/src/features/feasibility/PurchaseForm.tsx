import { Fragment, useId, useState, type FormEvent, type ReactNode } from "react";

import { centsToInput, parseCents } from "../../design/theme";
import type {
  CostItemIn,
  FeasibilityContext,
  FeasibilityRequest,
  LoaIn,
  OwnershipDefaults,
} from "../../lib/types";

/**
 * `schemas/feasibility.py`'s own bounds, mirrored so the field says no before
 * the network does. Each one is the Pydantic `ge`/`le` on the matching field;
 * the backend still enforces them, and its French 422 still surfaces.
 */
const MAX_HORIZON_MONTHS = 600; // FeasibilityIn.horizon_months
const MAX_RATE_BPS = 3_000; // annual_return_bps / loan_rate_bps, 30 %/an
const MAX_LOAN_MONTHS = 180; // schemas.feasibility.MAX_LOAN_MONTHS
const MAX_OWNERSHIP_YEARS = 30; // ownership.MAX_OWNERSHIP_YEARS
const MAX_LOA_MONTHS = 120; // LoaIn.months

/** `engines/feasibility.NATURES`, with this screen's French. */
const NATURE_LABEL: Record<string, string> = {
  vehicle: "Véhicule",
  property: "Immobilier",
  other: "Autre",
};

/**
 * A percentage typed with two decimals IS integer basis points, in exactly the
 * way an amount typed with two decimals is integer cents — "4,35" is 435 bps.
 * So the euro parser is the rate parser, string arithmetic and all, and no
 * float ever multiplies a rate into a cents value.
 */
const parseBps = parseCents;
const bpsToInput = centsToInput;

type FieldName =
  // One per running-cost item, keyed by the item's own `key`. Dynamic because
  // the list is the nature's, not this form's.
  | `item:${string}`
  | "target"
  | "horizon"
  | "down"
  | "return"
  | "loanRate"
  | "loanMonths"
  | "ownershipYears"
  | "loaDeposit"
  | "loaMonthly"
  | "loaMonths"
  | "loaResidual";

type Errors = Partial<Record<FieldName, string>>;

export interface PurchaseFormProps {
  /** Everything measured, so every hypothesis prefills from data. */
  context: FeasibilityContext;
  /** A saved scenario's question, reopened. The caller remounts this form with
   *  a new `key` when it changes: the fields are uncontrolled from the caller's
   *  point of view, and syncing them through an effect would fight whatever the
   *  user is in the middle of typing. */
  initial?: FeasibilityRequest | null;
  /** A computation is in flight: the submit is disabled AND says so. */
  busy: boolean;
  /** Whether the LOA block is revealed. Lifted, because `FinancingPanel`'s
   *  "saisir un devis de LOA" control opens it from the other end of the page. */
  showLoa: boolean;
  onToggleLoa: (open: boolean) => void;
  onSubmit: (request: FeasibilityRequest) => void;
}

/**
 * One running-cost item as the form holds it: a label, ONE amount, and which of
 * the two amounts it is.
 *
 * `unit` is the load-bearing field. `engines/ownership.CostItem` carries
 * exactly one of `monthly_cents` and `annual_bps_of_value`, and the engine
 * refuses both-or-neither with a French 422 — so a form that flattened every
 * item to a monthly euro figure could not send a taxe foncière back at all, and
 * one that guessed the unit from what the user typed would silently change what
 * a line means. It is read from the default (or from a reopened scenario) and
 * never inferred afterwards.
 */
interface ItemDraft {
  key: string;
  label: string;
  unit: "monthly" | "bps";
  /** What the field shows, in `unit`'s own unit. */
  text: string;
}

function draftFrom(item: CostItemIn): ItemDraft {
  return item.monthly_cents !== null
    ? { key: item.key, label: item.label, unit: "monthly", text: centsToInput(item.monthly_cents) }
    : {
        key: item.key,
        label: item.label,
        unit: "bps",
        text: bpsToInput(item.annual_bps_of_value ?? 0),
      };
}

/** A nature's prefilled items, or a reopened scenario's own edited ones. */
function draftsFor(
  defaults: Record<string, OwnershipDefaults>,
  nature: string,
  saved?: CostItemIn[] | null,
): ItemDraft[] {
  const source = saved ?? defaults[nature]?.items ?? [];
  return source.map(draftFrom);
}

/** A whole number of months or years, refused rather than coerced. */
function parseCount(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/**
 * The question, and the hypotheses it is answered under.
 *
 * Every euro field goes through `parseCents` and every rate through the same
 * function under its rate name: string arithmetic, and `null` rather than 0 on
 * anything unreadable, so a mistyped price can never be sent as nothing.
 *
 * The four hypotheses sit in a collapsed group and are prefilled from
 * `context.assumptions` — the declared defaults the backend would use anyway —
 * and each is labelled as a hypothesis rather than as a measurement, per design
 * §10. The measured ones (income, existing instalments) are NOT here: they are
 * not editable, and the context banner above states them.
 */
export function PurchaseForm({
  context,
  initial = null,
  busy,
  showLoa,
  onToggleLoa,
  onSubmit,
}: PurchaseFormProps) {
  const baseId = useId();
  const [target, setTarget] = useState(
    initial === null ? "" : centsToInput(initial.target_cents),
  );
  const [horizon, setHorizon] = useState(String(initial?.horizon_months ?? 12));
  const [down, setDown] = useState(centsToInput(initial?.down_payment_cents ?? 0));
  const [nature, setNature] = useState(initial?.nature ?? context.natures[0] ?? "vehicle");
  const [openAssumptions, setOpenAssumptions] = useState(false);
  const [openItems, setOpenItems] = useState(false);
  // Prefilled from the chosen nature's French averages, and reset to the new
  // nature's when it changes -- a car's carburant on a flat is not an average,
  // it is a leftover. Reset in the select's own handler rather than in an
  // effect, so it cannot fire while the user is mid-edit for any other reason.
  const [items, setItems] = useState<ItemDraft[]>(() =>
    draftsFor(context.ownership_defaults, initial?.nature ?? context.natures[0] ?? "vehicle",
      initial?.ownership_items),
  );

  const [annualReturn, setAnnualReturn] = useState(
    bpsToInput(initial?.annual_return_bps ?? context.assumptions.annual_return_bps),
  );
  const [loanRate, setLoanRate] = useState(
    bpsToInput(initial?.loan_rate_bps ?? context.assumptions.loan_rate_bps),
  );
  const [loanMonths, setLoanMonths] = useState(
    String(initial?.loan_months ?? context.assumptions.loan_months),
  );
  const [ownershipYears, setOwnershipYears] = useState(
    String(initial?.ownership_years ?? context.assumptions.ownership_years),
  );

  const [loaDeposit, setLoaDeposit] = useState(
    initial?.loa ? centsToInput(initial.loa.deposit_cents) : "",
  );
  const [loaMonthly, setLoaMonthly] = useState(
    initial?.loa ? centsToInput(initial.loa.monthly_cents) : "",
  );
  const [loaMonths, setLoaMonths] = useState(String(initial?.loa?.months ?? 48));
  const [loaResidual, setLoaResidual] = useState(
    initial?.loa ? centsToInput(initial.loa.residual_cents) : "",
  );

  const [errors, setErrors] = useState<Errors>({});

  const fieldId = (field: FieldName) => `${baseId}-${field}`;
  const errorId = (field: FieldName) => `${baseId}-${field}-error`;

  function clearField(field: FieldName) {
    setErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validate(): { request: FeasibilityRequest } | { errors: Errors } {
    const found: Errors = {};

    const targetCents = parseCents(target);
    if (targetCents === null) {
      found.target = "Montant illisible : saisissez un prix en euros, par exemple 40 000,00.";
    } else if (targetCents <= 0) {
      found.target =
        "Le prix doit être strictement positif : un bien à 0 € n'a rien dont la faisabilité se pose.";
    }

    const horizonMonths = parseCount(horizon, 1, MAX_HORIZON_MONTHS);
    if (horizonMonths === null) {
      found.horizon = `Échéance illisible : un nombre entier de mois, entre 1 et ${MAX_HORIZON_MONTHS}.`;
    }

    // An emptied apport is zero, and only here: most purchases start from
    // nothing, and the backend's own default is 0.
    const downText = down.trim();
    const downCents = downText.length === 0 ? 0 : parseCents(downText);
    if (downCents === null) {
      found.down = "Montant illisible : saisissez un apport en euros, par exemple 5 000,00.";
    } else if (downCents < 0) {
      found.down = "L'apport ne peut pas être négatif : c'est une somme détenue, pas un mouvement.";
    }

    const returnBps = parseBps(annualReturn);
    if (returnBps === null || returnBps < 0 || returnBps > MAX_RATE_BPS) {
      found.return = `Taux illisible : un pourcentage entre 0,00 et ${bpsToInput(MAX_RATE_BPS)}.`;
    }
    const loanRateBps = parseBps(loanRate);
    if (loanRateBps === null || loanRateBps < 0 || loanRateBps > MAX_RATE_BPS) {
      found.loanRate = `Taux illisible : un pourcentage entre 0,00 et ${bpsToInput(MAX_RATE_BPS)}.`;
    }
    const loanTerm = parseCount(loanMonths, 1, MAX_LOAN_MONTHS);
    if (loanTerm === null) {
      found.loanMonths = `Durée illisible : un nombre entier de mois, entre 1 et ${MAX_LOAN_MONTHS}.`;
    }
    const years = parseCount(ownershipYears, 1, MAX_OWNERSHIP_YEARS);
    if (years === null) {
      found.ownershipYears = `Durée illisible : un nombre entier d'années, entre 1 et ${MAX_OWNERSHIP_YEARS}.`;
    }

    let loa: LoaIn | undefined;
    if (showLoa && [loaDeposit, loaMonthly, loaResidual].some((v) => v.trim().length > 0)) {
      const deposit = parseCents(loaDeposit.trim().length === 0 ? "0" : loaDeposit);
      const monthly = parseCents(loaMonthly.trim().length === 0 ? "0" : loaMonthly);
      const residual = parseCents(loaResidual.trim().length === 0 ? "0" : loaResidual);
      const months = parseCount(loaMonths, 1, MAX_LOA_MONTHS);
      if (deposit === null || deposit < 0) {
        found.loaDeposit = "Montant illisible : un premier loyer en euros, par exemple 5 000,00.";
      }
      if (monthly === null || monthly < 0) {
        found.loaMonthly = "Montant illisible : un loyer mensuel en euros, par exemple 450,00.";
      }
      if (residual === null || residual < 0) {
        found.loaResidual = "Montant illisible : une valeur de rachat en euros.";
      }
      if (months === null) {
        found.loaMonths = `Durée illisible : un nombre entier de mois, entre 1 et ${MAX_LOA_MONTHS}.`;
      }
      if (
        deposit !== null &&
        monthly !== null &&
        residual !== null &&
        months !== null &&
        Object.keys(found).length === 0
      ) {
        loa = {
          deposit_cents: deposit,
          monthly_cents: monthly,
          months,
          residual_cents: residual,
        };
      }
    }

    // Each item keeps ITS OWN unit. Both amounts on one item, or neither, is a
    // French 422 from the engine (`ownership._validate`), so the unset one is
    // sent as an explicit null rather than omitted.
    const costItems: CostItemIn[] = [];
    for (const item of items) {
      const value = item.unit === "monthly" ? parseCents(item.text) : parseBps(item.text);
      if (value === null || value < 0) {
        found[`item:${item.key}`] =
          item.unit === "monthly"
            ? `« ${item.label} » : montant illisible. Un montant mensuel en euros, par exemple 65,00.`
            : `« ${item.label} » : taux illisible. Un pourcentage annuel de la valeur du bien, par exemple 0,90.`;
        continue;
      }
      costItems.push(
        item.unit === "monthly"
          ? { key: item.key, label: item.label, monthly_cents: value, annual_bps_of_value: null }
          : { key: item.key, label: item.label, monthly_cents: null, annual_bps_of_value: value },
      );
    }

    if (Object.keys(found).length > 0) return { errors: found };

    const request: FeasibilityRequest = {
      target_cents: targetCents as number,
      horizon_months: horizonMonths as number,
      down_payment_cents: downCents as number,
      nature,
      annual_return_bps: returnBps as number,
      loan_rate_bps: loanRateBps as number,
      loan_months: loanTerm as number,
      ownership_years: years as number,
    };
    // Always sent, even untouched: what leaves this form is exactly what the
    // user can see and change, and the unedited list is byte-for-byte the
    // default the backend would have applied anyway. On a nature that prefills
    // nothing this is an empty list, which the API reads as "no running costs
    // at all" -- the same answer `defaults_for("other")` gives.
    request.ownership_items = costItems;
    // Omitted, never zeroed: a LOA nobody quoted must reach the engine as
    // absent, so `levers._reason_no_loa_terms` can say so instead of Yieldo
    // inventing a contract.
    if (loa !== undefined) request.loa = loa;
    return { request };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validate();
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.request);
  }

  function field(
    which: FieldName,
    label: string,
    input: (props: {
      id: string;
      "aria-invalid": boolean;
      "aria-describedby": string | undefined;
    }) => ReactNode,
  ) {
    const message = errors[which];
    return (
      <div className="yd-purchase__field">
        <label htmlFor={fieldId(which)}>{label}</label>
        {input({
          id: fieldId(which),
          "aria-invalid": message !== undefined,
          "aria-describedby": message !== undefined ? errorId(which) : undefined,
        })}
        {message !== undefined ? (
          <p id={errorId(which)} role="alert" className="yd-purchase__error">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  function amountField(
    which: FieldName,
    label: string,
    value: string,
    set: (text: string) => void,
    placeholder: string,
  ) {
    return field(which, label, (props) => (
      <input
        {...props}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => {
          set(event.target.value);
          clearField(which);
        }}
        placeholder={placeholder}
      />
    ));
  }

  function countField(
    which: FieldName,
    label: string,
    value: string,
    set: (text: string) => void,
  ) {
    return field(which, label, (props) => (
      <input
        {...props}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          set(event.target.value);
          clearField(which);
        }}
      />
    ));
  }

  return (
    <form className="yd-purchase" onSubmit={submit} noValidate>
      <div className="yd-purchase__grid">
        {amountField("target", "Prix du bien (€)", target, setTarget, "40 000,00")}
        {countField("horizon", "Échéance (mois)", horizon, setHorizon)}
        {amountField("down", "Apport déjà disponible (€)", down, setDown, "0,00")}

        <div className="yd-purchase__field">
          <label htmlFor={fieldId("target")+"-nature"}>Nature du bien</label>
          <select
            id={fieldId("target") + "-nature"}
            value={nature}
            onChange={(event) => {
              setNature(event.target.value);
              // A car's carburant on a flat is a leftover, not an average.
              setItems(draftsFor(context.ownership_defaults, event.target.value));
              setErrors({});
            }}
          >
            {context.natures.map((value) => (
              <option key={value} value={value}>
                {NATURE_LABEL[value] ?? value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="yd-purchase__disclosure">
        <button
          type="button"
          className="yd-purchase__toggle"
          aria-expanded={openAssumptions}
          onClick={() => setOpenAssumptions((open) => !open)}
        >
          {`Hypothèses (${openAssumptions ? "masquer" : "afficher"})`}
        </button>
        <button
          type="button"
          className="yd-purchase__toggle"
          aria-expanded={openItems}
          onClick={() => setOpenItems((open) => !open)}
        >
          {`Postes de fonctionnement (${openItems ? "masquer" : "ajuster"})`}
        </button>
        <button
          type="button"
          className="yd-purchase__toggle"
          aria-expanded={showLoa}
          onClick={() => onToggleLoa(!showLoa)}
        >
          {`Devis de LOA (${showLoa ? "masquer" : "saisir"})`}
        </button>
      </div>

      {openAssumptions ? (
        <fieldset className="yd-purchase__group">
          <legend>Hypothèses — choisies, jamais mesurées</legend>
          <div className="yd-purchase__grid">
            {amountField(
              "return",
              "Rendement annuel de l'épargne (%)",
              annualReturn,
              setAnnualReturn,
              "3,00",
            )}
            {amountField("loanRate", "Taux du crédit (%)", loanRate, setLoanRate, "5,00")}
            {countField("loanMonths", "Durée du prêt (mois)", loanMonths, setLoanMonths)}
            {countField(
              "ownershipYears",
              "Durée de possession (années)",
              ownershipYears,
              setOwnershipYears,
            )}
          </div>
          <p className="yd-purchase__note">
            Ces quatre valeurs sont des hypothèses, pas des mesures : elles ne viennent pas de vos
            relevés et vous pouvez les changer. Vos revenus et vos mensualités en cours, eux, sont
            mesurés — ils sont rappelés au-dessus et ne se saisissent pas ici.
          </p>
        </fieldset>
      ) : null}

      {openItems ? (
        <fieldset className="yd-purchase__group">
          <legend>Postes de fonctionnement — moyennes françaises, ajustables</legend>
          {items.length === 0 ? (
            // `defaults_for("other")` prefills nothing, on purpose: inventing a
            // fuel budget for a canapé would be a fabricated figure wearing a
            // French average's clothes.
            <p className="yd-purchase__note">
              Aucun poste n'est prérempli pour ce type de bien. Yieldo n'invente pas de moyenne là
              où il n'en connaît pas : le coût de possession se limitera à la décote.
            </p>
          ) : (
            <>
              <div className="yd-purchase__grid">
                {/* `amountField` builds its own <div> and has no key to give,
                    so the list's key lives on a Fragment around it — a wrapper
                    that adds no DOM and cannot change the grid's layout. React
                    warns about this in the console and nowhere else, which is
                    why it took a browser to find. */}
                {items.map((item) => (
                  <Fragment key={item.key}>
                    {amountField(
                      `item:${item.key}`,
                      item.unit === "monthly"
                        ? `${item.label} (€ par mois)`
                        : `${item.label} (% de la valeur par an)`,
                      item.text,
                      (text) =>
                        setItems((current) =>
                          current.map((one) => (one.key === item.key ? { ...one, text } : one)),
                        ),
                      item.unit === "monthly" ? "65,00" : "0,90",
                    )}
                  </Fragment>
                ))}
              </div>
              <p className="yd-purchase__note">
                Chaque poste est une moyenne française, pas une mesure tirée de vos relevés :
                ajustez-le si le vôtre diffère. Les postes en euros sont constants ; ceux en
                pourcentage sont prélevés chaque année sur la valeur restante du bien, ce qui rend
                une voiture de huit ans moins chère à entretenir qu'une neuve.
              </p>
            </>
          )}
        </fieldset>
      ) : null}

      {showLoa ? (
        <fieldset className="yd-purchase__group">
          <legend>Location avec option d'achat — d'après le devis du concessionnaire</legend>
          <div className="yd-purchase__grid">
            {amountField("loaDeposit", "Premier loyer (€)", loaDeposit, setLoaDeposit, "5 000,00")}
            {amountField("loaMonthly", "Loyer mensuel (€)", loaMonthly, setLoaMonthly, "450,00")}
            {countField("loaMonths", "Durée de la LOA (mois)", loaMonths, setLoaMonths)}
            {amountField(
              "loaResidual",
              "Valeur de rachat (€)",
              loaResidual,
              setLoaResidual,
              "18 000,00",
            )}
          </div>
          <p className="yd-purchase__note">
            Yieldo n'invente aucun de ces montants : ils viennent du devis. Tant qu'ils ne sont pas
            saisis, la colonne LOA le dit plutôt que d'afficher une moyenne française.
          </p>
        </fieldset>
      ) : null}

      <div className="yd-purchase__actions">
        <button type="submit" className="yd-purchase__submit" disabled={busy}>
          {busy ? "Calcul en cours…" : "Calculer la faisabilité"}
        </button>
      </div>
    </form>
  );
}
