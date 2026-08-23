import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import type { MeasuredRate, RunwayScenario } from "../../lib/types";

/**
 * A duration in months, in French.
 *
 * Three cases, and they are three different claims:
 *
 * * `0` — `runway.py` returns exactly this on its `balance_cents <= 0` branch,
 *   which is the operator's own state (a liquid balance of −2 209,63 €). There
 *   is no autonomy left to count, and "moins d'un mois" would promise
 *   something still there to spend.
 * * under a month — written out rather than printed as "0,1 mois": a reader
 *   scanning a figure reads the leading zero as "about none".
 * * whole months — the decimal is dropped so "6 mois" does not read as
 *   "6,0 mois", which suggests a precision the median of three observations
 *   does not have.
 *
 * This formats `RunwayScenario.months`, the float DURATION. It is never the
 * right formatter for `MeasuredRate.months`, which is an integer count of
 * statements — see `sampleSentence`.
 */
export function formatMonths(months: number): string {
  if (months <= 0) return "Déjà épuisé";
  if (months < 1) return "moins d'un mois";
  const rounded = Math.round(months * 10) / 10;
  const body = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${body} mois`;
}

/**
 * How many months of statements THIS rate was measured over.
 *
 * Deliberately worded "de relevés" and never "mois" on its own: the duration
 * above it in the same panel is also a count of months, and the two numbers
 * routinely differ (0 mois d'autonomie, mesurée sur 3 mois de relevés). The
 * schema keeps them apart — `MeasuredRateOut.months` is a sample size,
 * `RunwayScenarioOut.months` a duration — and so must the copy.
 */
function sampleSentence(rate: MeasuredRate): string {
  // No `plural` here: "mois" is invariant and "relevés" is plural whatever the
  // count — a month holds many statements. "1 mois de relevés" is correct.
  return `Rythme mesuré sur ${rate.months} mois de relevés`;
}

interface RunwayPanelProps {
  scenario: RunwayScenario | null;
  label: string;
  /**
   * The reason THIS scenario could not be measured — `normal_unavailable_reason`
   * or `essentials_unavailable_reason`, never the other one. A review split
   * them apart because one message was blaming the month count when the real
   * cause was a non-positive burn, and `essentials` can fail on its own while
   * `normal` computes.
   */
  unavailableReason: string | null;
}

export function RunwayPanel({ scenario, label, unavailableReason }: RunwayPanelProps) {
  if (scenario === null) {
    return (
      <div className="yd-runway yd-runway--unavailable">
        <span className="yd-runway__label">{label}</span>
        <span className="yd-runway__months yd-runway__months--words">Non mesurable</span>
        <p className="yd-runway__unavailable">
          {/* The contract is "set exactly when the scenario is null". A null
              reason here is a backend defect, and an empty panel would hide
              it — no silent failures. */}
          {unavailableReason ??
            "Ce scénario n'a pas pu être mesuré et le serveur n'a pas indiqué pourquoi."}
        </p>
      </div>
    );
  }

  const exhausted = scenario.months <= 0;
  const undated = scenario.depleted_on === null;
  const duration = formatMonths(scenario.months);

  return (
    <div className="yd-runway">
      <span className="yd-runway__label">{label}</span>
      <span
        className={`yd-runway__months${undated || exhausted ? " yd-runway__months--words" : ""}`}
      >
        {/* Past fifty years `runway.py` withholds the date and the month count
            itself stops meaning anything a reader can hold — 900 months is not
            an answer, "plus de cinquante ans" is. */}
        {undated ? "Plus de cinquante ans" : duration}
      </span>

      {exhausted ? (
        // `depleted_on` is `today` on this branch, not a forecast. Printing
        // "épuisé le 22 août 2026" would read as a date still to come.
        <p className="yd-runway__detail">
          Le solde est déjà à zéro ou négatif : il n'y a plus d'autonomie à compter.
        </p>
      ) : undated ? (
        <p className="yd-runway__detail">
          Aucune date n'est avancée au-delà de cinquante ans : elle ne voudrait rien dire.
        </p>
      ) : scenario.depleted_on !== null ? (
        <p className="yd-runway__detail">{`Épuisé le ${frenchDate(scenario.depleted_on)}`}</p>
      ) : null}

      <p className="yd-runway__burn">
        <span className="yd-num">{formatCents(scenario.monthly_burn_cents)}</span>
        {" par mois, en médiane"}
      </p>

      {/* Requirement 4: the band, never the median alone. `capacity.py`: "A
          rate quoted without them invites the reader to treat a median as a
          certainty." */}
      <p className="yd-runway__band">
        {`Entre ${formatCents(scenario.rate.low_cents)} et ${formatCents(scenario.rate.high_cents)} d'un mois à l'autre`}
      </p>

      {scenario.rate.low_cents <= 0 ? (
        // A P10 expense below zero means the dispersion is wider than the
        // median itself: on this sample the burn is not distinguishable from
        // no burn at all, and the duration above rests on that median.
        <p className="yd-runway__caveat">
          La fourchette basse descend sous zéro : les écarts entre mois dépassent la médiane
          elle-même, cette autonomie est donc un ordre de grandeur, pas une échéance.
        </p>
      ) : null}

      <p className="yd-runway__sample">{sampleSentence(scenario.rate)}</p>
    </div>
  );
}
