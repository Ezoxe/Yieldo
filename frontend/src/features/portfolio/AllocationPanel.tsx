import { formatCents, formatQuantity, formatRateBps } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { AssetClassDrift, PortfolioAllocation } from "../../lib/types";
import { assetClassLabel } from "./HoldingsPanel";

/** A drift bar's two marks: where the class actually sits, and where it was
 *  aimed. Both as a percentage of the track, clamped to it — a class at 140 %
 *  of a 70 % target must not paint outside its own row. */
function trackPercent(bps: number): number {
  return Math.min(100, Math.max(0, bps / 100));
}

function DriftRow({ drift }: { drift: AssetClassDrift }) {
  const over = drift.drift_bps > 0;
  const onTarget = drift.drift_cents === 0;

  return (
    <li className="yd-drift" data-testid={`yd-drift-${drift.asset_class}`}>
      <div className="yd-drift__head">
        <h3 className="yd-drift__label">{assetClassLabel(drift.asset_class)}</h3>
        <span className="yd-drift__figures">
          <span className="yd-drift__current" data-testid={`yd-drift-current-${drift.asset_class}`}>
            {formatRateBps(drift.current_bps)}
          </span>
          <span className="yd-drift__target">{`cible ${formatRateBps(drift.target_bps)}`}</span>
        </span>
      </div>

      {/* The track carries BOTH marks. A bar alone would say where the class is
          and leave the target to a number elsewhere on the row; the whole point
          of this row is the distance between the two. The track sits in a grid
          row with a definite inline size — a percentage width in an auto-width
          flex column resolves against nothing and renders at zero. */}
      <div
        className="yd-drift__track"
        role="meter"
        aria-label={`${assetClassLabel(drift.asset_class)} : répartition actuelle`}
        aria-valuenow={Math.round(drift.current_bps / 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${formatRateBps(drift.current_bps)} pour une cible de ${formatRateBps(
          drift.target_bps,
        )}`}
      >
        <div
          className="yd-drift__fill"
          style={{ width: `${trackPercent(drift.current_bps)}%` }}
          data-testid={`yd-drift-fill-${drift.asset_class}`}
        />
        <div
          className="yd-drift__target-mark"
          style={{ left: `${trackPercent(drift.target_bps)}%` }}
          aria-hidden="true"
        />
      </div>

      <p className="yd-drift__gap">
        {onTarget
          ? "Sur la cible, à l'euro près."
          : `${over ? "Surpondérée" : "Sous-pondérée"} de ${formatRateBps(
              Math.abs(drift.drift_bps),
            )} : ${formatCents(Math.abs(drift.drift_cents))} ${over ? "de trop" : "manquants"} sur ${formatCents(drift.current_value_cents)} détenus.`}
      </p>
    </li>
  );
}

/**
 * The target allocation, the drift from it, and the orders that would close it.
 *
 * Three things this panel refuses to do:
 *
 * 1. **It never invents a target.** A household that has declared none gets the
 *    backend's own French sentence and no report at all — a drift table full of
 *    zeroes would be a measurement nobody made.
 * 2. **It never prints a zero-quantity trade.** The engine refuses to size an
 *    order smaller than one whole unit of a non-fractionable instrument, and
 *    that refusal is printed as prominently as a trade would have been — it is
 *    the answer, not the absence of one. A "0 unité" row would look actionable
 *    and change nothing.
 * 3. **It never runs a quantity through a money formatter.** `formatQuantity`
 *    for units, `formatCents` for the euros they are worth.
 */
export function AllocationPanel({ allocation }: { allocation: PortfolioAllocation }) {
  if (allocation.report === null) {
    return (
      <div className="yd-alloc" data-testid="yd-allocation">
        <p className="yd-patrimoine__refusal" data-testid="yd-allocation-refusal">
          {allocation.unavailable_reason}
        </p>
        <p className="yd-patrimoine__note">
          Une allocation cible se déclare par classe d'actifs — par exemple 60 % d'actions, 30 %
          d'obligations et 10 % de liquidités. Yieldo n'en propose aucune par défaut : la
          répartition visée est une décision qui vous appartient, pas une recommandation que cette
          application se permettrait de faire.
        </p>
      </div>
    );
  }

  const report = allocation.report;
  const incomplete = report.holdings_valued < report.holdings_total;

  return (
    <div className="yd-alloc" data-testid="yd-allocation">
      <p className="yd-alloc__basis" data-testid="yd-allocation-basis">
        {`Écart mesuré sur ${formatCents(report.total_value_cents)}, soit ${
          report.holdings_valued
        } ${plural(report.holdings_valued, "position valorisée", "positions valorisées")} sur ${
          report.holdings_total
        }.`}
        {incomplete
          ? " Une position sans prix n'entre ni au numérateur ni au dénominateur : elle n'est pas comptée comme valant zéro."
          : ""}
      </p>

      <ul className="yd-drifts">
        {report.drifts.map((drift) => (
          <DriftRow key={drift.asset_class} drift={drift} />
        ))}
      </ul>

      {report.trades.length > 0 ? (
        <div className="yd-alloc__section">
          <h3 className="yd-alloc__section-title">Ordres qui refermeraient l'écart</h3>
          <ul className="yd-trades">
            {report.trades.map((trade) => (
              <li
                key={`${trade.asset_class}-${trade.symbol}`}
                className={`yd-trade yd-trade--${trade.action}`}
                data-testid={`yd-trade-${trade.symbol}`}
              >
                <span className="yd-trade__action">
                  {trade.action === "buy" ? "Acheter" : "Vendre"}
                </span>
                <span className="yd-trade__quantity" data-testid={`yd-trade-qty-${trade.symbol}`}>
                  {/* Units. Never `formatCents`. */}
                  {`${formatQuantity(trade.quantity)} ${plural(
                    Number(trade.quantity.split(".")[0]),
                    "unité",
                    "unités",
                  )}`}
                </span>
                <span className="yd-trade__symbol">{trade.symbol}</span>
                <span className="yd-trade__value">
                  {`≈ ${formatCents(trade.estimated_value_cents)}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="yd-patrimoine__note">
            Une estimation au dernier prix connu, pas un ordre passé : Yieldo ne se connecte à
            aucun courtier et n'exécute rien. Les frais et la fiscalité ne sont pas déduits ici.
          </p>
        </div>
      ) : null}

      {report.refusals.length > 0 ? (
        <div className="yd-alloc__section">
          <h3 className="yd-alloc__section-title">Écarts qu'aucun ordre ne peut refermer</h3>
          <ul className="yd-refusals">
            {report.refusals.map((refusal) => (
              <li
                key={`${refusal.asset_class}-${refusal.symbol}`}
                className="yd-patrimoine__refusal"
                data-testid={`yd-refusal-${refusal.asset_class}`}
              >
                {/* The engine's own sentence, verbatim: it already names the
                    instrument, the gap and the unit price. */}
                {refusal.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.trades.length === 0 && report.refusals.length === 0 ? (
        <p className="yd-patrimoine__note" data-testid="yd-allocation-on-target">
          Aucun ordre n'est proposé : chaque classe est déjà sur sa cible.
        </p>
      ) : null}
    </div>
  );
}
