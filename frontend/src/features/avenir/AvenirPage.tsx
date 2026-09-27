import { useEffect, useState } from "react";
import { Link } from "react-router";

import { OutlookChart } from "../../charts/OutlookChart";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { CalendarIcon, CashflowIcon, ClockIcon, ProjectionIcon } from "../../design/icons";
import { InfoTip } from "../../design/InfoTip";
import { PageHead } from "../../design/PageHead";
import "../../design/Skeleton.css";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { Outlook, OutlookReliability, OutlookScope } from "../../lib/types";
import {
  dayLabel,
  endOfMonthAnswer,
  lowPointContext,
  reliabilityAnswer,
  riskPill,
} from "./answers";
import "./AvenirPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";
// Past a week without a statement, the reader is told the projection starts in
// the past.
const STALE_AFTER_DAYS = 7;

type Zoom = 90 | 365;

const SCOPES: { value: OutlookScope; label: string }[] = [
  { value: "checking", label: "Comptes courants" },
  { value: "liquid", label: "Tout le disponible" },
];
const ZOOMS: { value: Zoom; label: string }[] = [
  { value: 90, label: "90 jours" },
  { value: 365, label: "12 mois" },
];

const SPAN = {
  tile: { base: 1, md: 6, lg: 4 },
  full: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

interface Segmented<T> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

function SegmentedControl<T extends string | number>({ label, options, value, onChange }: Segmented<T>) {
  return (
    <div className="yd-avenir__segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          className={option.value === value ? "is-active" : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function AvenirPage() {
  const [scope, setScope] = useState<OutlookScope>("checking");
  const [zoom, setZoom] = useState<Zoom>(90);
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  const [reliability, setReliability] = useState<OutlookReliability | null>(null);
  const [errors, setErrors] = useState<{ outlook?: string; reliability?: string }>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Two independent questions: one failing never blanks the other.
    Promise.allSettled([
      api.get<Outlook>("/outlook", { scope, horizon_days: zoom }),
      api.get<OutlookReliability>("/outlook/reliability", { scope }),
    ]).then(([projected, measured]) => {
      if (cancelled) return;
      const next: { outlook?: string; reliability?: string } = {};
      if (projected.status === "fulfilled") setOutlook(projected.value);
      else next.outlook = messageFor(projected.reason);
      if (measured.status === "fulfilled") setReliability(measured.value);
      else next.reliability = messageFor(measured.reason);
      setErrors(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, zoom]);

  const controls = (
    <div className="yd-avenir__controls">
      <SegmentedControl label="Périmètre" options={SCOPES} value={scope} onChange={setScope} />
      <SegmentedControl label="Horizon" options={ZOOMS} value={zoom} onChange={setZoom} />
    </div>
  );

  return (
    <section className="yd-avenir">
      <PageHead icon={CashflowIcon} title="Avenir" actions={controls}
        shortLead="Votre argent, jour après jour.">
        Ce que votre argent va devenir, jour après jour.
      </PageHead>

      {errors.outlook ? (
        <p role="alert" className="yd-avenir__error">
          Prévision indisponible : {errors.outlook}
        </p>
      ) : null}

      {loading && outlook === null ? (
        <BentoGrid role="status" aria-busy="true" aria-label="Chargement de l'avenir">
          {[0, 1, 2].map((index) => (
            <BentoCell key={index} span={SPAN.tile} className="yd-panel">
              <div className="yd-skeleton yd-skeleton--cf-title" aria-hidden="true" />
              <div className="yd-skeleton yd-skeleton--cf-balance" aria-hidden="true" />
            </BentoCell>
          ))}
        </BentoGrid>
      ) : null}

      {outlook !== null && outlook.empty_reason ? (
        <p className="yd-avenir__empty">{outlook.empty_reason}</p>
      ) : null}

      {outlook !== null && !outlook.empty_reason ? (
        <>
          {outlook.stale_days > STALE_AFTER_DAYS ? (
            <p className="yd-avenir__stale">
              Vos relevés s'arrêtent au {dayLabel(outlook.as_of)} : tout ce qui suit est
              projeté. <Link to="/import">Importer mes relevés</Link>
            </p>
          ) : null}
          <Answers outlook={outlook} reliability={reliability}
                   reliabilityError={errors.reliability} />
          <BentoGrid>
            <BentoCell span={SPAN.full} className="yd-panel" data-ai-target="panel-avenir-courbe">
              <PanelHead
                icon={CashflowIcon}
                subtitle={`Au ${dayLabel(outlook.as_of)} : ${formatCents(outlook.opening_balance_cents, { signed: true })}`}
                actions={
                  <InfoTip label="Comment la courbe est tracée">
                    La médiane additionne vos échéances connues et vos dépenses courantes,
                    réparties selon {outlook.profile_measured
                      ? "votre propre façon de dépenser au fil du mois"
                      : "un rythme régulier (pas encore assez de mois pour mesurer le vôtre)"}.
                    {outlook.band
                      ? ` La bande couvre huit cas sur dix, mesurée sur ${outlook.residual_months} mois de relevés ; elle s'élargit avec la distance.`
                      : ` ${outlook.band_unavailable_reason ?? ""}`}
                  </InfoTip>
                }
              >
                Solde prévu, jour après jour
              </PanelHead>
              <OutlookChart outlook={outlook} />
            </BentoCell>
          </BentoGrid>
        </>
      ) : null}
    </section>
  );
}

function Answers({ outlook, reliability, reliabilityError }: {
  outlook: Outlook;
  reliability: OutlookReliability | null;
  reliabilityError?: string;
}) {
  const monthEnd = endOfMonthAnswer(outlook);
  const pill = riskPill(outlook);
  const context = lowPointContext(outlook);
  const trust = reliability ? reliabilityAnswer(reliability) : null;

  return (
    <BentoGrid>
      <BentoCell span={SPAN.tile} className="yd-panel yd-avenir__tile"
        data-ai-target="kpi-fin-de-mois">
        <PanelHead icon={CalendarIcon}>{monthEnd?.title ?? "Fin de mois prévue"}</PanelHead>
        {monthEnd ? (
          <>
            <p className="yd-avenir__figure yd-num">{formatCents(monthEnd.p50, { signed: true })}</p>
            {outlook.band ? (
              <p className="yd-avenir__sub yd-num">
                entre {formatCents(monthEnd.p10, { signed: true })} et{" "}
                {formatCents(monthEnd.p90, { signed: true })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="yd-avenir__sub">Aucune fin de mois dans l'horizon affiché.</p>
        )}
      </BentoCell>

      <BentoCell span={SPAN.tile} className="yd-panel yd-avenir__tile"
        data-ai-target="kpi-point-bas">
        <PanelHead icon={ProjectionIcon}
          actions={
            <InfoTip label="Ce que le point bas mesure">
              Le jour où le solde médian prévu est le plus bas sur l'horizon affiché. La pastille
              compare aussi la fourchette basse au{" "}
              {outlook.threshold_source === "alert" ? "seuil fixé dans Alertes" : "zéro"}.
            </InfoTip>
          }
        >
          Point bas
        </PanelHead>
        {outlook.low_point ? (
          <>
            <p className="yd-avenir__figure yd-num">
              {formatCents(outlook.low_point.p50_cents, { signed: true })}
            </p>
            <p className="yd-avenir__sub">
              {context
                ? `${dayLabel(outlook.low_point.on)}, ${context}`
                : dayLabel(outlook.low_point.on)}
            </p>
            <span className={`yd-avenir__pill yd-avenir__pill--${pill.tone}`}>{pill.text}</span>
          </>
        ) : null}
      </BentoCell>

      <BentoCell span={SPAN.tile} className="yd-panel yd-avenir__tile"
        data-ai-target="kpi-fiabilite">
        <PanelHead icon={ClockIcon}
          actions={
            <InfoTip label="Comment la fiabilité est mesurée">
              La même méthode, rejouée à chaque fin de mois de votre historique avec les seuls
              relevés connus ce jour-là, comparée au solde réellement atteint un mois plus tard.
              Vos déclarations et événements prévus n'y sont pas : ils n'ont pas d'historique.
            </InfoTip>
          }
        >
          Fiabilité mesurée
        </PanelHead>
        {reliabilityError ? (
          <p role="alert" className="yd-avenir__sub">{reliabilityError}</p>
        ) : trust === null ? null : trust.kind === "measured" ? (
          <>
            <p className="yd-avenir__figure yd-num">{trust.headline}</p>
            <p className="yd-avenir__sub">{trust.detail}</p>
          </>
        ) : (
          <p className="yd-avenir__sub">{trust.reason}</p>
        )}
      </BentoCell>
    </BentoGrid>
  );
}
