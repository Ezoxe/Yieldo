import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { AlertsIcon, CoinsIcon, InfoIcon, ListIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { centsToInput, formatCents, parseCents } from "../../design/theme";
import "../../design/Skeleton.css";
import { api } from "../../lib/api";
import { plural } from "../../lib/plural";
import { messageFor } from "../../lib/refusal";
import type { Alert, AlertCondition, AlertReport } from "../../lib/types";
import "./AlertsPage.css";

const SPAN = {
  alerts: { base: 1, md: 6, lg: 7 },
  threshold: { base: 1, md: 6, lg: 5 },
  full: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const LONG_DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

/** `"2025-06"` → `"juin 2025"`. Local rather than `Intl`: the engine builds
 *  the same label server-side for every sentence it writes, and two different
 *  spellings of the same month on one screen is its own small lie. */
function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTHS_FR[Number(month) - 1] ?? month} ${year}`;
}

function dateLabel(iso: string | null): string | null {
  if (iso === null) return null;
  const value = new Date(`${iso}T00:00:00`);
  return Number.isNaN(value.getTime()) ? null : LONG_DATE.format(value);
}

/**
 * One alert, as three labelled claims and never as one paragraph.
 *
 * The severity is printed as a WORD (`severity_label`) as well as carried by
 * the card's left rule: a reader who cannot separate the accent from the
 * warning tone still reads "Critique" or "Pour information".
 */
function AlertCard({ alert }: { alert: Alert }) {
  const on = dateLabel(alert.on);
  return (
    <li
      className={`yd-alert yd-alert--${alert.severity}`}
      data-testid={`yd-alert-${alert.kind}`}
    >
      <div className="yd-alert__head">
        <h3 className="yd-alert__title">{alert.title}</h3>
        <span className={`yd-alert__severity yd-alert__severity--${alert.severity}`}>
          {alert.severity_label}
        </span>
      </div>
      {alert.amount_cents !== null || on !== null ? (
        <p className="yd-alert__figure">
          {alert.amount_cents !== null ? (
            <span className="yd-alert__amount">{formatCents(alert.amount_cents)}</span>
          ) : null}
          {on !== null ? <span className="yd-alert__on">{on}</span> : null}
        </p>
      ) : null}
      <dl className="yd-alert__claims">
        <div className="yd-alert__claim">
          <dt>Ce qui a été mesuré</dt>
          <dd className="yd-alert__measured">{alert.measured}</dd>
        </div>
        <div className="yd-alert__claim">
          <dt>Sur quelle période</dt>
          <dd className="yd-alert__period">{alert.period}</dd>
        </div>
        <div className="yd-alert__claim">
          <dt>Ce qui la lèverait</dt>
          <dd className="yd-alert__clears">{alert.clears_when}</dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * One of the five conditions, in whichever of its four states it is in.
 *
 * Fired; measured and silent; measured with a subject deliberately set aside;
 * or not measurable at all. Four different answers, and the screen shows all
 * five conditions always — a blank screen is otherwise indistinguishable from
 * a broken one, and "no alert" would read as "nothing is wrong" when it
 * sometimes means "nothing was looked at".
 */
function ConditionRow({ condition }: { condition: AlertCondition }) {
  // FOUR states, not three. A condition that measured what it could and set a
  // subject ASIDE has not found "rien à signaler": something was deliberately
  // not judged, and a green "all clear" beside a refusal printed underneath it
  // is a contradiction the reader has to resolve themselves.
  const state = !condition.measured
    ? { className: "unmeasured", text: "Non mesurée" }
    : condition.alert_count > 0
      ? {
          className: "firing",
          text: `${condition.alert_count} ${plural(condition.alert_count, "alerte", "alertes")}`,
        }
      : condition.withheld.length > 0
        ? {
            className: "withheld",
            text: `${condition.withheld.length} ${plural(
              condition.withheld.length,
              "sujet écarté",
              "sujets écartés",
            )}`,
          }
        : { className: "clear", text: "Mesurée, rien à signaler" };

  return (
    <li
      className={`yd-cond yd-cond--${state.className}`}
      data-testid={`yd-cond-${condition.kind}`}
    >
      <div className="yd-cond__head">
        <h3 className="yd-cond__label">{condition.label}</h3>
        <span className={`yd-cond__state yd-cond__state--${state.className}`}>{state.text}</span>
      </div>
      <p className="yd-cond__detail">{condition.detail}</p>
      {condition.withheld.length > 0 ? (
        <ul className="yd-cond__withheld" data-testid={`yd-cond-withheld-${condition.kind}`}>
          {condition.withheld.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * `/alertes` — the five conditions, and everything that was NOT measured.
 * Design §12, phase 4 plan Task 10.
 *
 * **The screen is designed for the operator's actual state, which is mostly
 * silence.** On his own 197 transactions two anomalies fire and nothing else
 * does: no threshold is stored, no budget is declared, no subscription has
 * risen, and the one label without a recent charge is a pharmacy card spend
 * whose amounts vary too much to call a scheduled debit. A feed showing an
 * empty list there would say "tout va bien", which is a claim nobody
 * measured. So the five conditions are always on screen, each saying which of
 * four things it is: fired, measured and silent, measured with a subject set
 * aside, or unmeasurable — the last two carrying their own French cause.
 *
 * **The import gap governs everything below it**, so it is stated once at the
 * top rather than repeated on each card. Eight months inside the operator's
 * own ledger hold nothing; an absence in one of them is a hole in the data,
 * not an event, and no alert is raised about it.
 */
export function AlertsPage() {
  const reduced = useReducedMotion();
  const [report, setReport] = useState<AlertReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [floorInput, setFloorInput] = useState("");
  const [floorError, setFloorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const loaded = await api.get<AlertReport>("/alerts");
        if (cancelled) return;
        setReport(loaded);
        setFloorInput(
          loaded.settings.balance_floor_cents === null
            ? ""
            : centsToInput(loaded.settings.balance_floor_cents),
        );
      } catch (err) {
        if (!cancelled) setError(messageFor(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function writeFloor(cents: number | null) {
    setError(null);
    setSaving(true);
    try {
      await api.put("/alerts/settings", { balance_floor_cents: cents });
      // Re-read rather than patch: changing the floor changes which projection
      // was run and therefore what the balance condition says — a locally
      // patched settings object would leave a stale sentence beside a new
      // threshold.
      const refreshed = await api.get<AlertReport>("/alerts");
      setReport(refreshed);
      setFloorInput(cents === null ? "" : centsToInput(cents));
      setFloorError(null);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSaving(false);
    }
  }

  function submitFloor(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseCents(floorInput);
    if (cents === null) {
      // Refused here, in French, rather than sending something the API can
      // only answer 422 to. An empty box is NOT zero — clearing the floor is
      // its own button.
      setFloorError(
        floorInput.trim() === ""
          ? "Aucun montant saisi. Un champ vide n'est pas un seuil à 0 € : pour ne plus surveiller de plancher, utilisez « Ne plus surveiller de seuil »."
          : "Montant illisible. Saisissez un nombre d'euros, par exemple « -500 » ou « 1 200,50 ».",
      );
      return;
    }
    setFloorError(null);
    void writeFloor(cents);
  }

  const coverage = report?.coverage;
  const missing = coverage?.missing_months ?? [];
  const lastOn = dateLabel(report?.ledger_last_on ?? null);

  return (
    <section className="yd-alerts">
      <PageHead icon={AlertsIcon} title="Alertes" className="yd-alerts__header">

        <p className="yd-alerts__lead">
          Cinq conditions mesurées sur vos propres relevés. Chacune dit{" "}
          <strong>ce qui a été mesuré, sur quelle période, et ce qui la lèverait</strong> — et
          quand elle n'a rien pu mesurer, elle le dit aussi plutôt que de se taire.{" "}
          <strong>Aucune alerte n'est levée sur des données qui n'ont pas été mesurées.</strong>
        </p>
      </PageHead>

      {error !== null ? (
        <p role="alert" className="yd-alerts__alert" data-testid="yd-alerts-error">
          {error}
        </p>
      ) : null}

      {report === null ? (
        <div role="status" aria-busy="true" aria-label="Chargement des alertes">
          <div className="yd-skeleton yd-skeleton--patrimoine-card" aria-hidden="true" />
        </div>
      ) : (
        <BentoGrid as={motion.div} {...staggerProps(reduced)}>
          <BentoCell
            as={motion.div}
            span={SPAN.full}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <PanelHead icon={InfoIcon}>Ce que vos relevés couvrent</PanelHead>
            <p className="yd-alerts__coverage" data-testid="yd-alerts-coverage">
              {coverage?.first_on === null || coverage === undefined
                ? "Aucun relevé importé : il n'y a rien à surveiller, et rien ne sera inventé pour le faire croire."
                : `Du ${dateLabel(coverage.first_on)} au ${lastOn} — ${
                    coverage.covered_months.length
                  } ${plural(
                    coverage.covered_months.length,
                    "mois porte des opérations",
                    "mois portent des opérations",
                  )}.`}
            </p>
            {report.notice !== null ? (
              <p className="yd-alerts__gap" data-testid="yd-alerts-gap">
                {report.notice}
              </p>
            ) : coverage?.first_on !== null ? (
              <p className="yd-alerts__note">
                Aucun trou&nbsp;: chaque mois compris entre le premier et le dernier relevé porte
                au moins une opération.
              </p>
            ) : null}
            {missing.length > 0 ? (
              <ul className="yd-alerts__months" data-testid="yd-alerts-missing">
                {missing.map((key) => (
                  <li key={key}>{monthLabel(key)}</li>
                ))}
              </ul>
            ) : null}
          </BentoCell>

          <BentoCell
            as={motion.div}
            span={SPAN.alerts}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <PanelHead icon={ListIcon}>
              {report.alerts.length === 0
                ? "Aucune alerte en cours"
                : `${report.alerts.length} ${plural(
                    report.alerts.length,
                    "alerte en cours",
                    "alertes en cours",
                  )}`}
            </PanelHead>
            {report.alerts.length === 0 ? (
              <p className="yd-alerts__empty" data-testid="yd-alerts-empty">
                Rien ne s'est déclenché. Ce n'est pas la même chose que «&nbsp;tout va
                bien&nbsp;»&nbsp;: le tableau ci-dessous dit, condition par condition, ce qui a
                réellement été mesuré et ce qui n'a pas pu l'être.
              </p>
            ) : (
              <ul className="yd-alerts__list" data-testid="yd-alerts-list">
                {report.alerts.map((alert) => (
                  <AlertCard key={alert.key} alert={alert} />
                ))}
              </ul>
            )}
          </BentoCell>

          <BentoCell
            as={motion.div}
            span={SPAN.threshold}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <PanelHead icon={CoinsIcon}>Seuil de solde projeté</PanelHead>
            <p className="yd-alerts__note">
              Le seul réglage de cet écran. Yieldo projette votre solde sur douze mois et vous
              prévient si le <strong>pire dixième</strong> de cette projection passe sous le seuil
              que vous fixez ici. Un découvert autorisé se saisit en négatif.
            </p>
            <p className="yd-alerts__rule" data-testid="yd-alerts-floor-rule">
              <strong>Un seuil non renseigné n'est pas un seuil à 0&nbsp;€.</strong> Tant que vous
              n'en avez pas fixé un, Yieldo ne surveille aucun plancher et ne lève aucune alerte
              sur le solde — plutôt que de vous en inventer un.
            </p>
            <form className="yd-floor" onSubmit={submitFloor}>
              <label className="yd-floor__field" htmlFor="yd-alerts-floor">
                <span>Seuil (€)</span>
                <input
                  id="yd-alerts-floor"
                  type="text"
                  inputMode="decimal"
                  value={floorInput}
                  autoComplete="off"
                  placeholder="-500,00"
                  aria-invalid={floorError !== null || undefined}
                  aria-describedby={floorError !== null ? "yd-alerts-floor-error" : undefined}
                  onChange={(event) => setFloorInput(event.target.value)}
                />
              </label>
              {floorError !== null ? (
                <p
                  className="yd-floor__error"
                  id="yd-alerts-floor-error"
                  data-testid="yd-alerts-floor-error"
                >
                  {floorError}
                </p>
              ) : null}
              <p className="yd-floor__state" data-testid="yd-alerts-floor-state">
                {report.settings.balance_floor_cents === null
                  ? "Aucun seuil enregistré pour l'instant."
                  : `Seuil enregistré : ${formatCents(report.settings.balance_floor_cents)}.`}
              </p>
              <div className="yd-floor__actions">
                <button
                  type="submit"
                  className="yd-floor__action yd-floor__action--primary"
                  disabled={saving}
                >
                  {saving ? "Enregistrement…" : "Enregistrer le seuil"}
                </button>
                {report.settings.balance_floor_cents !== null ? (
                  <button
                    type="button"
                    className="yd-floor__action"
                    disabled={saving}
                    onClick={() => void writeFloor(null)}
                  >
                    Ne plus surveiller de seuil
                  </button>
                ) : null}
              </div>
            </form>
          </BentoCell>

          <BentoCell
            as={motion.div}
            span={SPAN.full}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <PanelHead icon={AlertsIcon}>Les cinq conditions, une par une</PanelHead>
            <p className="yd-alerts__note">
              Chacune est dans exactement un de quatre états&nbsp;: elle s'est déclenchée&nbsp;;
              elle a été mesurée et n'a rien trouvé&nbsp;; elle a été mesurée mais a{" "}
              <strong>écarté</strong> un sujet qu'elle refuse de juger faute de données&nbsp;; ou
              elle n'a pas pu être mesurée du tout. Dans les deux derniers cas, elle nomme sa
              cause et son remède plutôt que de se taire.
            </p>
            <ul className="yd-conds" data-testid="yd-alerts-conditions">
              {report.conditions.map((condition) => (
                <ConditionRow key={condition.kind} condition={condition} />
              ))}
            </ul>
          </BentoCell>
        </BentoGrid>
      )}
    </section>
  );
}
