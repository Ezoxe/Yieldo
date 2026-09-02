import { frenchDate } from "../../design/EmptyState";
import { formatCents, formatQuantity } from "../../design/theme";
import type { PositionValuation } from "../../lib/types";
import { priceStateOf, staleAgeSentence } from "./priceState";

/** The seven asset classes `models/instrument.py` declares, in French. A class
 *  this map has no word for is printed as the backend spelled it rather than
 *  dropped — an unknown class is still a real one. */
export const ASSET_CLASS_LABEL: Record<string, string> = {
  equity: "Actions",
  etf: "ETF",
  bond: "Obligations",
  crypto: "Cryptomonnaies",
  cash: "Liquidités",
  real_estate: "Immobilier",
  other: "Autre",
};

export function assetClassLabel(key: string): string {
  return ASSET_CLASS_LABEL[key] ?? key;
}

/**
 * One holding's price cell — the place the three states are drawn as three
 * different SHAPES, not three tints of one colour.
 *
 * A missing price gets no numeral anywhere near it: a figure in this cell
 * would be a price nobody fetched. It gets the hatched "Prix indisponible"
 * band instead — the same device `/suivi` uses to keep a measured zero apart
 * from an unmeasured component — and the cause is printed on its own row
 * below, verbatim.
 */
function PriceCell({ position, now }: { position: PositionValuation; now: Date }) {
  const state = priceStateOf(position);

  if (state.kind === "missing") {
    return (
      <span className="yd-holding__absent-band" data-testid={`yd-holding-absent-${position.symbol}`}>
        Prix indisponible
      </span>
    );
  }

  if (state.kind === "not_required") {
    return <span className="yd-holding__muted">Aucune unité détenue</span>;
  }

  const age = state.kind === "stale" ? staleAgeSentence(state.price.fetched_at, now) : null;

  return (
    <span className="yd-holding__price">
      <span className="yd-holding__price-value">
        {formatCents(state.price.price_cents, { currency: position.currency })}
      </span>
      {state.kind === "stale" ? (
        <span className="yd-holding__stale" data-testid={`yd-holding-stale-${position.symbol}`}>
          {/* A stale price IS counted in the total — what it needs is its age,
              not a warning that it failed. */}
          {`Prix daté du ${frenchDate(state.price.as_of)}${age === null ? "" : `, ${age}`}`}
        </span>
      ) : (
        <span className="yd-holding__asof">{`au ${frenchDate(state.price.as_of)}`}</span>
      )}
    </span>
  );
}

function ValueCell({ position }: { position: PositionValuation }) {
  // `null` means NOT VALUED. Never zero, and never the cost basis standing in
  // for a value nobody could compute.
  if (position.market_value_reporting_cents === null) {
    return <span className="yd-holding__muted">—</span>;
  }
  return (
    <span className="yd-holding__value" data-testid={`yd-holding-value-${position.symbol}`}>
      {formatCents(position.market_value_reporting_cents)}
    </span>
  );
}

function GainCell({ position }: { position: PositionValuation }) {
  const gain = position.unrealised_gain_reporting_cents;
  if (gain === null) return <span className="yd-holding__muted">—</span>;
  return (
    <span
      className={`yd-holding__gain${
        gain < 0 ? " yd-holding__gain--negative" : gain > 0 ? " yd-holding__gain--positive" : ""
      }`}
    >
      {formatCents(gain, { signed: true })}
    </span>
  );
}

/**
 * Every declared position, with what is known about each and — as its own row
 * rather than as a tooltip — what is not.
 *
 * Rendered as a real `<table>`: this is tabular data with a header that names
 * each column, and a grid of `<div>`s would leave a screen reader with no way
 * to say which figure is a quantity and which is a price. At 375 px the table
 * scrolls inside its OWN container (`.yd-holdings__scroller`,
 * `overflow-x: auto`) rather than pushing the page sideways — the rule every
 * wide block on this project has followed since the credit schedule.
 */
export function HoldingsPanel({
  positions,
  reportingCurrency,
  now,
}: {
  positions: PositionValuation[];
  reportingCurrency: string;
  now: Date;
}) {
  return (
    <div className="yd-holdings">
      <div className="yd-holdings__scroller">
        <table className="yd-holdings__table" data-testid="yd-holdings-table" role="table">
          <caption className="sr-only">
            {`Vos positions : quantité détenue, prix unitaire, valeur en ${reportingCurrency} et plus-value latente.`}
          </caption>
          <thead>
            <tr role="row">
              <th scope="col" role="columnheader">
                Instrument
              </th>
              <th scope="col" role="columnheader">
                Classe
              </th>
              <th scope="col" role="columnheader" className="yd-holdings__num">
                Quantité
              </th>
              <th scope="col" role="columnheader" className="yd-holdings__num">
                Prix unitaire
              </th>
              <th scope="col" role="columnheader" className="yd-holdings__num">
                {`Valeur (${reportingCurrency})`}
              </th>
              <th scope="col" role="columnheader" className="yd-holdings__num">
                Plus-value latente
              </th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const state = priceStateOf(position);
              const unavailable =
                state.kind === "missing"
                  ? state.reason
                  : position.fx_unavailable_reason !== null
                    ? position.fx_unavailable_reason
                    : null;

              return (
                // A React fragment needs the key on the FRAGMENT, and both rows
                // belong to one position — a missing key here was found once
                // only by the browser console, with the whole suite green.
                <tr
                  key={position.position_id}
                  role="row"
                  className={`yd-holding${unavailable !== null ? " yd-holding--unvalued" : ""}`}
                  data-testid={`yd-holding-${position.symbol}`}
                >
                  <th scope="row" role="rowheader" className="yd-holding__id">
                    <span className="yd-holding__symbol">{position.symbol}</span>
                    <span className="yd-holding__name">{position.name}</span>
                    {unavailable !== null ? (
                      // The cause, verbatim and in full — never truncated, never
                      // behind a hover. Five causes, five remedies.
                      <span
                        className="yd-holding__reason"
                        data-testid={`yd-holding-reason-${position.symbol}`}
                      >
                        {unavailable}
                      </span>
                    ) : null}
                  </th>
                  {/* `data-label` is what each cell is called once the table
                      collapses into a card at narrow widths — the stylesheet
                      prints it with `content: attr(data-label)`. The French
                      lives here beside the value it labels, never in a CSS
                      string, and it matches the column header exactly. */}
                  <td role="cell" data-label="Classe">
                    {assetClassLabel(position.asset_class)}
                  </td>
                  <td role="cell" data-label="Quantité" className="yd-holdings__num">
                    {/* From the string, through `formatQuantity`. A quantity is
                        not money and never goes through `formatCents`. */}
                    <span className="yd-holding__quantity">{formatQuantity(position.quantity)}</span>
                  </td>
                  <td role="cell" data-label="Prix unitaire" className="yd-holdings__num">
                    <PriceCell position={position} now={now} />
                  </td>
                  <td
                    role="cell"
                    data-label={`Valeur (${reportingCurrency})`}
                    className="yd-holdings__num"
                  >
                    <ValueCell position={position} />
                  </td>
                  <td role="cell" data-label="Plus-value latente" className="yd-holdings__num">
                    <GainCell position={position} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
