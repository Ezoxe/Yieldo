import { formatCents, formatRateBps } from "../../design/theme";
import type { StressReport, StressScenario, StressShock } from "../../lib/types";

/** `models/instrument.py`'s INSTRUMENT_ASSET_CLASSES, in French. */
const CLASS_LABELS: Record<string, string> = {
  equity: "Actions",
  bond: "Obligations",
  real_estate: "Immobilier coté",
  crypto: "Cryptomonnaies",
  cash: "Liquidités",
  etf: "ETF",
  other: "Autre",
};

function className(key: string): string {
  return CLASS_LABELS[key] ?? key;
}

/**
 * The three named historical shocks, applied to what the household holds today.
 *
 * **None of this is a forecast, and the screen says so on every card, not once
 * at the top.** A stress test answers "what would today's holdings be worth if
 * this past episode happened again, unchanged" — never "what will happen". Each
 * card therefore carries the episode's PERIOD and its published SOURCE beside
 * the euro figure it produced, and a standing badge naming it a measured past.
 * A figure that looks like a prediction gets treated like one.
 *
 * The three are framed differently on purpose and the cards say which:
 * 2008 and 2020 are stated peak-to-trough, the way each crash is conventionally
 * discussed; 2022 is stated over the calendar year, the way that episode is.
 *
 * **A shock is not always a loss.** 2008's bond figure is positive — government
 * bonds rallied on the flight to quality while equities collapsed — and it is
 * painted as the gain it was. Flooring every class at a loss would erase the
 * one thing a stress test can actually show: which holdings cushioned which.
 *
 * **A class with no data for an episode is named, never folded in at 0 %.**
 * Bitcoin did not exist in 2008, and an ETF's true composition cannot be
 * recovered from its generic label. Those appear as an explicit absence and are
 * excluded from the totals, which the card states.
 */
export function StressPanel({ stress, refusal }: { stress: StressReport; refusal: string | null }) {
  return (
    <div className="yd-stress">
      <p className="yd-projection__note">
        Trois épisodes réels, appliqués tels quels à votre répartition actuelle.{" "}
        <strong>Ce ne sont pas des prévisions</strong>&nbsp;: aucun d'eux ne dit ce qui va se
        passer, chacun dit ce qui s'est passé et ce que cela aurait coûté à ce que vous détenez
        aujourd'hui.
      </p>

      {refusal !== null ? <p className="yd-projection__refusal">{refusal}</p> : null}

      <ul className="yd-stress__list">
        {stress.scenarios.length > 0
          ? stress.scenarios.map((scenario) => (
              <ScenarioCard key={scenario.shock.key} scenario={scenario} />
            ))
          : stress.shocks.map((shock) => <ShockCard key={shock.key} shock={shock} />)}
      </ul>
    </div>
  );
}

/** The badge every card carries. One component so the wording cannot drift
 *  between the applied cards and the un-applied ones. */
function MeasuredPast({ shock }: { shock: StressShock }) {
  return (
    <div className="yd-shock__provenance">
      <p className="yd-shock__badge">Épisode mesuré — pas une prévision</p>
      <p className="yd-shock__period">
        Période retenue&nbsp;: <strong>{shock.period}</strong>
      </p>
      <p className="yd-shock__source">Sources&nbsp;: {shock.source}</p>
    </div>
  );
}

/** The impacts an episode carries, as measured percentages per asset class.
 *  Shown even when there is no portfolio to apply them to: they are facts about
 *  market history, and they are what makes the refusal above legible. */
function ShockRates({ shock }: { shock: StressShock }) {
  const entries = Object.entries(shock.impact_bps_by_asset_class);
  return (
    <ul className="yd-shock__rates">
      {entries.map(([key, bps]) => (
        <li key={key} className="yd-shock__rate">
          <span className="yd-shock__rate-label">{className(key)}</span>
          <span
            className={`yd-shock__rate-value${
              bps > 0
                ? " yd-shock__rate-value--positive"
                : bps < 0
                  ? " yd-shock__rate-value--negative"
                  : ""
            }`}
          >
            {formatRateBps(bps)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ShockCard({ shock }: { shock: StressShock }) {
  return (
    <li className="yd-shock">
      <p className="yd-shock__label">{shock.label}</p>
      <MeasuredPast shock={shock} />
      <p className="yd-projection__note">
        Les taux réellement observés, par classe d'actifs. Yieldo ne peut pas encore les
        appliquer&nbsp;: voir la raison ci-dessus.
      </p>
      <ShockRates shock={shock} />
    </li>
  );
}

function ScenarioCard({ scenario }: { scenario: StressScenario }) {
  const { shock } = scenario;
  const untested = scenario.portfolio_value_cents - scenario.stressable_value_cents;

  return (
    <li className="yd-shock" data-testid={`yd-shock-${shock.key}`}>
      <p className="yd-shock__label">{shock.label}</p>
      <MeasuredPast shock={shock} />

      <div className="yd-shock__headline">
        <span className="yd-shock__headline-label">Effet sur la part testable</span>
        <span
          className={`yd-shock__headline-value${
            scenario.impact_cents > 0
              ? " yd-shock__headline-value--positive"
              : scenario.impact_cents < 0
                ? " yd-shock__headline-value--negative"
                : ""
          }`}
        >
          {formatCents(scenario.impact_cents, { signed: true })}
        </span>
        <span className="yd-shock__headline-note">
          {formatRateBps(scenario.impact_bps)} de {formatCents(scenario.stressable_value_cents)},
          qui deviendraient {formatCents(scenario.stressed_value_cents)}.
        </span>
      </div>

      {untested !== 0 || scenario.classes_without_data.length > 0 ? (
        <p className="yd-projection__note" data-testid={`yd-shock-untested-${shock.key}`}>
          <strong>{formatCents(untested)}</strong> sur {formatCents(scenario.portfolio_value_cents)}{" "}
          n'ont pas pu être testés&nbsp;:{" "}
          {scenario.classes_without_data.map(className).join(", ")} — cet épisode n'offre aucune
          donnée réelle pour {scenario.classes_without_data.length > 1 ? "ces classes" : "cette classe"}.
          Elles sont exclues des chiffres ci-dessus plutôt que comptées à 0 %, ce qui prétendrait
          qu'elles ont été mesurées et épargnées.
        </p>
      ) : null}

      {/* Four columns of tabular figures at 375px. Wide content scrolls inside
          its OWN box rather than pushing the page sideways — the rule since the
          credit schedule, and `shoot.mjs` measures it off the rendered box. */}
      <div className="yd-shock__scroller">
        <table className="yd-shock__table">
          <caption className="yd-shock__caption">Par classe d'actifs</caption>
          <thead>
            <tr>
              <th scope="col">Classe</th>
              <th scope="col">Aujourd'hui</th>
              <th scope="col">Choc</th>
              <th scope="col">Après le choc</th>
            </tr>
          </thead>
          <tbody>
            {scenario.by_class.map((impact) => (
              <tr key={impact.asset_class}>
                <th scope="row">{className(impact.asset_class)}</th>
                <td>{formatCents(impact.current_value_cents)}</td>
                <td
                  className={
                    impact.impact_bps === null
                      ? undefined
                      : impact.impact_bps > 0
                        ? "yd-shock__cell--positive"
                        : impact.impact_bps < 0
                          ? "yd-shock__cell--negative"
                          : undefined
                  }
                >
                  {impact.impact_bps === null ? (
                    <span className="yd-shock__absent-band">Aucune donnée</span>
                  ) : (
                    formatRateBps(impact.impact_bps)
                  )}
                </td>
                <td>
                  {impact.stressed_value_cents === null ? (
                    <span className="yd-shock__absent-band">Non testée</span>
                  ) : (
                    formatCents(impact.stressed_value_cents)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </li>
  );
}
