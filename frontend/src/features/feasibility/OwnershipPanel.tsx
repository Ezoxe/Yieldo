import { formatCents } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { Ownership } from "../../lib/types";

interface OwnershipPanelProps {
  ownership: Ownership;
  /** What the same money would have earned had it stayed placed, over the
   *  HOLDING period rather than the saving horizon. It lives on the report and
   *  not on `Ownership`, but it belongs beside the cost of owning: both answer
   *  "what does keeping this thing for five years cost me?". */
  opportunityCostCents: number;
  opportunityHorizonMonths: number;
}

/**
 * What owning the thing costs on top of buying it.
 *
 * Running costs and depreciation are stated SEPARATELY and then summed, because
 * one is money leaving the account and the other is value leaving the asset.
 * `engines/ownership.py` keeps them apart in its own report for the same
 * reason, and a panel that added them without saying so would be comparing two
 * different things under one total.
 */
export function OwnershipPanel({
  ownership,
  opportunityCostCents,
  opportunityHorizonMonths,
}: OwnershipPanelProps) {
  const years = ownership.years;

  return (
    <div className="yd-own">
      <p className="yd-own__lead">
        {`Sur ${years} ${plural(years, "an", "ans")} de possession, et sur un prix d'achat de ${formatCents(ownership.price_cents)}.`}
      </p>

      {ownership.lines.length === 0 ? (
        // `defaults_for("other")` returns nothing at all, on purpose: inventing
        // a fuel budget for a canapé would be a fabricated figure wearing a
        // French average's clothes.
        <p className="yd-own__empty">
          Aucun poste de fonctionnement n'est prérempli pour ce type de bien. Yieldo n'invente pas
          de moyenne là où il n'en connaît pas.
        </p>
      ) : (
        <div className="yd-own__table" data-testid="yd-own-lines">
          <div className="yd-own__row yd-own__row--head">
            <span>Poste</span>
            <span>{`Sur ${years} ${plural(years, "an", "ans")}`}</span>
            <span>Par mois</span>
          </div>
          {ownership.lines.map((line) => (
            <div className="yd-own__row" key={line.key}>
              <span className="yd-own__row-label">{line.label}</span>
              <span className="yd-own__row-value">
                {/* Below 560px the header row is hidden and the two figures
                    share a line, so each says which it is. */}
                <span className="yd-own__cell-label">{`sur ${years} ${plural(years, "an", "ans")} `}</span>
                {formatCents(line.total_cents)}
              </span>
              <span className="yd-own__row-value">
                <span className="yd-own__cell-label">par mois </span>
                {formatCents(line.monthly_average_cents)}
              </span>
            </div>
          ))}
          <div className="yd-own__row yd-own__row--total">
            <span className="yd-own__row-label">Total des frais de fonctionnement</span>
            <span className="yd-own__row-value">{formatCents(ownership.running_cost_cents)}</span>
            <span className="yd-own__row-value" />
          </div>
        </div>
      )}

      <p className="yd-own__split">
        {`Ces ${formatCents(ownership.running_cost_cents)} sont de l'argent qui quitte votre compte. La décote, elle, est de la valeur qui quitte le bien : `}
        <span className="yd-num">{formatCents(ownership.depreciation_cents)}</span>
        {` sur la période, ce qui laisse le bien à `}
        <span className="yd-num">{formatCents(ownership.residual_value_cents)}</span>
        {` au bout de ${years} ${plural(years, "an", "ans")}. Les deux comptent, mais pas de la même façon, et c'est pourquoi elles sont additionnées séparément.`}
      </p>

      <div className="yd-own__figures">
        <div className="yd-own__figure">
          <span className="yd-own__figure-label">
            {`Coût total de possession sur ${years} ${plural(years, "an", "ans")}`}
          </span>
          <span className="yd-own__figure-value">{formatCents(ownership.total_cost_cents)}</span>
          <span className="yd-own__figure-note">
            {`Frais de fonctionnement et décote réunis, soit ${formatCents(ownership.monthly_average_cents)} par mois en moyenne.`}
          </span>
        </div>
        <div className="yd-own__figure">
          <span className="yd-own__figure-label">Coût d'opportunité</span>
          <span className="yd-own__figure-value">{formatCents(opportunityCostCents)}</span>
          <span className="yd-own__figure-note">
            {`Ce que ce prix aurait rapporté s'il était resté placé pendant les ${opportunityHorizonMonths} mois de possession, au rendement retenu. Ce n'est pas une dépense : c'est un gain auquel vous renoncez.`}
          </span>
        </div>
      </div>

      {/* Design §6.3 item 3 asks for adjustable cost items. The API accepts them
          (`FeasibilityIn.ownership_items`) but `GET /api/feasibility/context`
          publishes no per-nature defaults for a form to start from, and
          reconstructing a `%-of-value` item from a monthly average is not
          possible. Saying so beats an editor that would silently reshape a line
          it could not read back. */}
      <p className="yd-own__note">
        Chaque poste est une moyenne française, pas une mesure tirée de vos relevés : une assurance,
        un entretien et un carburant d'ordre de grandeur, à ajuster si les vôtres diffèrent. Ils ne
        sont pas encore modifiables depuis cet écran.
      </p>
    </div>
  );
}
