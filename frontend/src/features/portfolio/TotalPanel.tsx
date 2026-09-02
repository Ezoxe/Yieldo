import { formatCents } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { PortfolioTotal } from "../../lib/types";

/**
 * What the portfolio is worth, and — inseparably — what it could not value.
 *
 * `engines/portfolio.py` bundles `market_value_cents` with
 * `positions_missing_price` / `positions_missing_fx` into one object on
 * purpose, so that a caller "cannot render the total without the completeness
 * counts sitting right next to it". **This component renders both or
 * neither.** The counts are not a footnote that appears when something went
 * wrong: they are printed on every branch, including the one where everything
 * was valued, because "3 positions sur 3 valorisées" is what makes the figure
 * above it mean anything at all.
 *
 * The total is a sum over WHAT COULD BE VALUED. When something could not be,
 * the figure is not the portfolio's worth — it is a floor — and the sentence
 * says so in those words rather than leaving the reader to infer it.
 */
export function TotalPanel({
  total,
  reportingCurrency,
}: {
  total: PortfolioTotal;
  reportingCurrency: string;
}) {
  const incomplete = total.positions_missing_price + total.positions_missing_fx > 0;
  const gain = total.unrealised_gain_cents;

  return (
    <div className="yd-ptotal" data-testid="yd-portfolio-total">
      <div className="yd-ptotal__figure">
        <p className="yd-ptotal__label">
          {incomplete ? "Valeur de ce qui a pu être valorisé" : "Valeur de marché"}
        </p>
        <p className="yd-ptotal__amount" data-testid="yd-portfolio-total-amount">
          {formatCents(total.market_value_cents)}
        </p>
        <p className="yd-ptotal__currency">
          {`en ${reportingCurrency}, devises converties au taux du jour`}
        </p>
      </div>

      {/* Always printed, on every branch. See the component docstring. */}
      <p className="yd-ptotal__completeness" data-testid="yd-portfolio-completeness">
        {`${total.positions_valued} ${plural(
          total.positions_valued,
          "position valorisée",
          "positions valorisées",
        )} sur ${total.positions_total}.`}
      </p>

      {incomplete ? (
        <p className="yd-patrimoine__refusal" data-testid="yd-portfolio-incomplete">
          {[
            total.positions_missing_price > 0
              ? `${total.positions_missing_price} ${plural(
                  total.positions_missing_price,
                  "position n'a pas de prix",
                  "positions n'ont pas de prix",
                )}`
              : null,
            total.positions_missing_fx > 0
              ? `${total.positions_missing_fx} ${plural(
                  total.positions_missing_fx,
                  "position n'a pas de taux de change",
                  "positions n'ont pas de taux de change",
                )}`
              : null,
          ]
            .filter((part) => part !== null)
            .join(", et ")}
          {`. ${plural(
            total.positions_missing_price + total.positions_missing_fx,
            "Elle n'est pas comptée",
            "Elles ne sont pas comptées",
          )} dans le total ci-dessus : le montant affiché est donc un plancher, pas la valeur du portefeuille. Le détail de chaque cause est sur la ligne de la position concernée.`}
        </p>
      ) : null}

      <div className="yd-ptotal__rows">
        <div className="yd-ptotal__row">
          <span className="yd-ptotal__row-label">Prix de revient</span>
          <span className="yd-ptotal__row-value">{formatCents(total.cost_basis_cents)}</span>
        </div>
        <div className="yd-ptotal__row">
          <span className="yd-ptotal__row-label">Plus-value latente</span>
          <span
            className={`yd-ptotal__row-value${
              gain < 0 ? " yd-ptotal__row-value--negative" : gain > 0 ? " yd-ptotal__row-value--positive" : ""
            }`}
            data-testid="yd-portfolio-gain"
          >
            {formatCents(gain, { signed: true })}
          </span>
        </div>
      </div>

      <p className="yd-patrimoine__note">
        Latente : rien n'a été vendu, aucun impôt n'est calculé ici. Le prix de revient est la
        somme de vos lots d'acquisition, jamais une estimation.
      </p>
    </div>
  );
}
