import { ProjectionFanChart, bandsFor } from "../../charts/ProjectionFanChart";
import { formatCents, formatRateBps } from "../../design/theme";
import type { MonteCarloProjection } from "../../lib/types";

/**
 * The Monte Carlo band, with the figures that read off its last month.
 *
 * **Never a single number.** The three end-of-horizon figures are shown
 * together, as a range, and the median is labelled as one centile among three
 * rather than as "the" answer. A hero figure here would be the exact claim the
 * engine's percentile bands exist to refuse.
 *
 * The lower centile is printed with its own consequence when it goes below
 * zero: a negative P10 is not a small number, it is a household that ran out,
 * and the words say so beside the numeral.
 */
export function MonteCarloPanel({ projection }: { projection: MonteCarloProjection }) {
  const bands = bandsFor(projection.assumptions.percentiles);
  const last = projection.points[projection.points.length - 1];
  const low = bands && last ? last.percentiles_cents[bands.low] : null;
  const median = bands && last ? last.percentiles_cents[bands.median] : null;
  const high = bands && last ? last.percentiles_cents[bands.high] : null;

  return (
    <div className="yd-mc">
      <p className="yd-projection__note">
        Chaque mois, chacune des{" "}
        <strong>{projection.assumptions.trials.toLocaleString("fr-FR")} trajectoires</strong> tire
        son propre rendement dans une loi normale de moyenne{" "}
        {formatRateBps(projection.assumptions.annual_return_bps)} et d'écart-type{" "}
        {formatRateBps(projection.assumptions.annual_volatility_bps)} par an. La bande est la
        distribution de ces trajectoires, pas une prévision&nbsp;: Yieldo calcule, il ne prédit
        pas.
      </p>

      <ProjectionFanChart projection={projection} />

      {bands !== null && low !== null && median !== null && high !== null ? (
        <>
          <p className="yd-projection__section-title">
            À l'horizon, sur {projection.points.length} mois
          </p>
          <ul className="yd-mc__bands">
            <li className="yd-mc__band">
              <span className="yd-mc__band-label">{`Pire dixième (P${bands.low})`}</span>
              <span
                className={`yd-mc__band-value${low < 0 ? " yd-mc__band-value--negative" : ""}`}
              >
                {formatCents(low)}
              </span>
              <span className="yd-mc__band-note">
                {low < 0
                  ? "Une trajectoire sur dix finit au moins aussi bas : le capital est épuisé et le découvert continue de se creuser. La bande n'est pas ramenée à zéro — ce serait effacer précisément ce risque."
                  : "Une trajectoire sur dix finit au plus à ce niveau."}
              </span>
            </li>
            <li className="yd-mc__band">
              <span className="yd-mc__band-label">{`Médiane (P${bands.median})`}</span>
              <span className="yd-mc__band-value">{formatCents(median)}</span>
              <span className="yd-mc__band-note">
                La moitié des trajectoires finissent au-dessus, l'autre moitié en dessous. Ce
                n'est pas « le » résultat attendu.
              </span>
            </li>
            <li className="yd-mc__band">
              <span className="yd-mc__band-label">{`Meilleur dixième (P${bands.high})`}</span>
              <span className="yd-mc__band-value">{formatCents(high)}</span>
              <span className="yd-mc__band-note">
                Une trajectoire sur dix finit au moins à ce niveau.
              </span>
            </li>
          </ul>
          <p className="yd-projection__note">
            Point de départ&nbsp;: <strong>{formatCents(projection.initial_cents)}</strong> —
            la valeur de vos positions effectivement valorisées. Versement mensuel appliqué&nbsp;:{" "}
            <strong>{formatCents(projection.assumptions.monthly_cents, { signed: true })}</strong>,
            votre capacité d'épargne mesurée, avec son signe.
          </p>
        </>
      ) : null}
    </div>
  );
}
