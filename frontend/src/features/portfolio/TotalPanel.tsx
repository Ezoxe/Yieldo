import { formatCents } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { CashHolding, DeclaredHolding, PortfolioTotal } from "../../lib/types";

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
/** "au 31 août 2026", or nothing at all when the household did not say. The
 *  date is never invented: a declared amount with no date is reported without
 *  one rather than dressed up as today's. */
export function declaredOnSentence(declaredOn: string | null): string {
  if (declaredOn === null) return "";
  return ` au ${new Date(`${declaredOn}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

export function TotalPanel({
  total,
  reportingCurrency,
  declared = [],
  declaredTotalCents = 0,
  cash = [],
  cashTotalCents = 0,
}: {
  total: PortfolioTotal;
  reportingCurrency: string;
  declared?: DeclaredHolding[];
  declaredTotalCents?: number;
  cash?: CashHolding[];
  cashTotalCents?: number;
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

      {/* The declared half of the figure above, itemised. Printed only when
          there is one, and never merged into the position counts below: a
          declared envelope was not valued from a price, so counting it as a
          "position valorisée" would overstate what the application measured. */}
      {declaredTotalCents !== 0 ? (
        <div className="yd-ptotal__declared" data-testid="yd-portfolio-declared">
          <p className="yd-ptotal__declared-head">
            {`Dont ${formatCents(declaredTotalCents)} déclarés par vous, sans position en face :`}
          </p>
          <ul className="yd-ptotal__declared-list">
            {declared.map((holding) => (
              <li key={holding.account_id}>
                {`${holding.name} — `}
                <span className="yd-num">{formatCents(holding.value_cents)}</span>
                {declaredOnSentence(holding.declared_on)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The savings accounts, itemised like the declared amounts and for the
          same reason: a bank balance was not valued from a price either, and
          counting it as a "position valorisée" would overstate what was
          measured. Before the audit of 2026-09-06 they were simply absent, and
          a household's Livret A read as nothing at all. */}
      {cashTotalCents !== 0 ? (
        <div className="yd-ptotal__declared" data-testid="yd-portfolio-cash">
          <p className="yd-ptotal__declared-head">
            {`Dont ${formatCents(cashTotalCents)} sur vos comptes d'épargne, au solde de vos relevés :`}
          </p>
          <ul className="yd-ptotal__declared-list">
            {cash.map((holding) => (
              <li key={holding.account_id}>
                {`${holding.name} — `}
                <span className="yd-num">{formatCents(holding.balance_cents)}</span>
                {holding.transaction_count === 0
                  ? " (solde initial, aucune opération importée)"
                  : ` (${holding.transaction_count} ${plural(holding.transaction_count, "opération", "opérations")})`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
