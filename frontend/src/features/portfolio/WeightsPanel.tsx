import { formatCents } from "../../design/theme";
import type { WeightedGroup } from "../../lib/types";
import { assetClassLabel } from "./HoldingsPanel";

/** A ratio in 0..1 as a French percentage, through integer basis points —
 *  `formatRateBps` already owns that formatting for every rate in this app, so
 *  the rounding to whole basis points is the one and only conversion, and it
 *  is explicit. */
function weightPercent(weight: number): string {
  const bps = Math.round(weight * 10_000);
  return `${Math.trunc(bps / 100)},${String(bps % 100).padStart(2, "0")} %`;
}

/**
 * How the portfolio splits, by whichever dimension the caller passes.
 *
 * **The denominator is what could be VALUED, not what is held**, and the panel
 * says so rather than leaving it to be assumed. Two positions, one of them
 * unpriced, do not make the priced one "50 % of the portfolio" — it is 100 %
 * of what Yieldo could put a number on, and those are different claims. The
 * backend computes it the second way (`engines/portfolio.py`); this sentence
 * is what stops the screen reporting it as the first.
 */
export function WeightsPanel({
  groups,
  dimension,
  incomplete,
}: {
  groups: WeightedGroup[];
  dimension: "asset_class" | "currency";
  incomplete: boolean;
}) {
  if (groups.length === 0) {
    return (
      <p className="yd-patrimoine__note">
        Aucune position n'a pu être valorisée : il n'y a pas de répartition à calculer. Une part
        de rien n'est pas zéro, c'est une part qui n'existe pas.
      </p>
    );
  }

  return (
    <div className="yd-weights">
      <ul className="yd-weights__list">
        {groups.map((group) => (
          <li className="yd-weight" key={group.key} data-testid={`yd-weight-${group.key}`}>
            <div className="yd-weight__head">
              <span className="yd-weight__label">
                {dimension === "asset_class" ? assetClassLabel(group.key) : group.key}
              </span>
              <span className="yd-weight__percent">{weightPercent(group.weight)}</span>
            </div>
            <div
              className="yd-weight__track"
              role="meter"
              aria-label={dimension === "asset_class" ? assetClassLabel(group.key) : group.key}
              aria-valuenow={Math.round(group.weight * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${weightPercent(group.weight)}, soit ${formatCents(group.value_cents)}`}
            >
              <div
                className="yd-weight__fill"
                style={{ width: `${Math.min(100, group.weight * 100)}%` }}
                data-testid={`yd-weight-fill-${group.key}`}
              />
            </div>
            <span className="yd-weight__amount">{formatCents(group.value_cents)}</span>
          </li>
        ))}
      </ul>

      <p className="yd-patrimoine__note" data-testid={`yd-weights-basis-${dimension}`}>
        {incomplete
          ? "Ces parts sont calculées sur ce qui a pu être valorisé, pas sur tout ce que vous détenez : une position sans prix est absente du dénominateur, elle n'y compte pas pour zéro."
          : "Ces parts sont calculées sur ce qui a pu être valorisé — ici, la totalité de vos positions."}
      </p>
    </div>
  );
}
