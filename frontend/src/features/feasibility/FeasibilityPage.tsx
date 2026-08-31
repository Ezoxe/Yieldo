import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { EmptyState, historySentence } from "../../design/EmptyState";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { formatCents } from "../../design/theme";
import { api } from "../../lib/api";
import { plural } from "../../lib/plural";
import { messageFor, refusalReason } from "../../lib/refusal";
import type {
  Feasibility,
  FeasibilityContext,
  FeasibilityRequest,
  MeasuredRate,
  Scenario,
} from "../../lib/types";
import "./FeasibilityPage.css";
import { FinancingPanel } from "./FinancingPanel";
import { ImpactPanel } from "./ImpactPanel";
import { LeverList } from "./LeverList";
import { OwnershipPanel } from "./OwnershipPanel";
import { PurchaseForm } from "./PurchaseForm";
import { ScenarioBar } from "./ScenarioBar";
import { VerdictPanel } from "./VerdictPanel";

/**
 * One measured rate, as a figure with its band and its sample — or the words
 * that say it could not be measured.
 *
 * "Non mesurable" and never "0 € par mois": a zero is a measurement, and this
 * is the absence of one. `GoalsPage` words its own capacity panel the same way.
 */
function MeasureTile({
  title,
  rate,
  detail,
  signed = true,
  toned = true,
}: {
  title: string;
  rate: MeasuredRate | null;
  /** What this rate is FOR, in one clause. Never a restatement of the title. */
  detail: string;
  signed?: boolean;
  /** Whether the sign carries a verdict. TRUE only for the savings capacity: a
   *  negative one is a household going backwards, and green/red is the whole
   *  message. A spending rate painted green reads as approval of the spending,
   *  and an income rate painted green says nothing its own figure does not. */
  toned?: boolean;
}) {
  return (
    <div className="yd-measure">
      <p className="yd-measure__title">{title}</p>
      {rate === null ? (
        <p className="yd-measure__value yd-measure__value--words">Non mesurable</p>
      ) : (
        <>
          <p
            className={`yd-measure__value${
              !toned ? " yd-measure__value--neutral" : rate.median_cents < 0
                ? " yd-measure__value--negative"
                : " yd-measure__value--positive"
            }`}
          >
            {formatCents(rate.median_cents, { signed })}
          </p>
          <p className="yd-measure__band">
            {`Entre ${formatCents(rate.low_cents, { signed })} et ${formatCents(rate.high_cents, {
              signed,
            })} d'un mois à l'autre, sur ${rate.months} mois de relevés.`}
          </p>
        </>
      )}
      <p className="yd-measure__detail">{detail}</p>
    </div>
  );
}

/**
 * One source of truth for the shape of this screen, so the loading skeletons and
 * the loaded content land on the same cells at the same spans and nothing moves
 * when the data arrives.
 */
const SPAN = {
  full: { base: 1, md: 6, lg: 12 },
  form: { base: 1, md: 6, lg: 5 },
  verdict: { base: 1, md: 6, lg: 7 },
  half: { base: 1, md: 6, lg: 6 },
} satisfies Record<string, BentoSpan>;

export function FeasibilityPage() {
  const reduced = useReducedMotion();

  const [context, setContext] = useState<FeasibilityContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [report, setReport] = useState<Feasibility | null>(null);
  // Two states with two different treatments, and never one boolean derived
  // from both: a network failure is an alert, an engine's refusal is content.
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportRefusal, setReportRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLoa, setShowLoa] = useState(false);

  // The question that produced `report`, kept so a scenario can store it. It is
  // the REQUEST and never the answer: `POST /feasibility/scenarios` stores the
  // question, and every read recomputes.
  const [asked, setAsked] = useState<FeasibilityRequest | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioToken, setScenarioToken] = useState(0);
  // Remounts the form on a reopened question rather than syncing its fields
  // through an effect, which would fight whatever the user is typing.
  const [reopened, setReopened] = useState<{ request: FeasibilityRequest; key: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const body = await api.get<FeasibilityContext>("/feasibility/context");
        if (cancelled) return;
        setContext(body);
        setContextError(null);
      } catch (err) {
        if (cancelled) return;
        setContext(null);
        setContextError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const body = await api.get<Scenario[]>("/feasibility/scenarios");
        if (cancelled) return;
        setScenarios(body);
        setScenarioError(null);
      } catch (err) {
        if (cancelled) return;
        // The list is a side panel: it failing is no reason to blank the
        // verdict, so it reports against its own cell.
        setScenarios([]);
        setScenarioError(messageFor(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [scenarioToken]);

  async function ask(request: FeasibilityRequest) {
    setBusy(true);
    setReportError(null);
    setReportRefusal(null);
    try {
      const body = await api.post<Feasibility>("/feasibility", request);
      setReport(body);
      setAsked(request);
    } catch (err) {
      const refusal = refusalReason(err);
      setReport(null);
      setAsked(null);
      if (refusal !== null) setReportRefusal(refusal);
      else setReportError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  function renderContext(measured: FeasibilityContext): ReactNode {
    return (
      <div className="yd-context">
        <div className="yd-context__measures">
          <MeasureTile
            title="Capacité d'épargne"
            rate={measured.capacity}
            detail="Ce qui reste chaque mois, mesuré sur vos relevés et jamais déclaré. C'est de cette médiane que dépend le verdict."
          />
          <MeasureTile
            title="Rythme de dépenses"
            rate={measured.expense_rate}
            signed={false}
            toned={false}
            detail="Ce que coûte un mois normal. C'est ce que votre solde doit couvrir, et donc ce qui fixe votre autonomie."
          />
          <MeasureTile
            title="Revenus mesurés"
            rate={measured.income_rate}
            signed={false}
            toned={false}
            detail="Ce qui entre chaque mois. Le taux d'endettement d'un crédit se calcule sur cette somme — sans elle, il n'est pas calculé du tout."
          />
        </div>

        <div className="yd-context__facts">
          <p className="yd-context__fact">
            {"Solde disponible aujourd'hui : "}
            <span
              className={`yd-num${measured.balance_cents < 0 ? " yd-context__fact--negative" : ""}`}
            >
              {formatCents(measured.balance_cents, { signed: true })}
            </span>
          </p>
          <p className="yd-context__fact">
            {"Mensualités de crédit déjà engagées : "}
            <span className="yd-num">
              {formatCents(measured.existing_debt_payments_cents)}
            </span>
            {" par mois."}
          </p>
        </div>

        <p className="yd-context__note">
          {`${measured.months_observed} ${plural(measured.months_observed, "mois complet", "mois complets")} ${plural(measured.months_observed, "observé", "observés")} dans votre historique.`}
          {measured.history !== null ? ` ${historySentence(measured.history)}` : ""}
        </p>

        {measured.capacity === null ? (
          <>
            <p className="yd-feas__refusal">
              Votre capacité d'épargne n'a pas encore pu être mesurée : il faut au moins trois mois
              complets de relevés pour en tirer une médiane. Aucun verdict ne peut être rendu tant
              qu'elle est inconnue.
            </p>
            <Link className="yd-feas__link" to="/import">
              Importer des relevés
            </Link>
          </>
        ) : measured.capacity.median_cents <= 0 ? (
          // THE OPERATOR'S OWN STATE, said before he types a price rather than
          // after. The remedy is NOT the import screen, and offering it here
          // would send him to repair a ledger that is not broken.
          <p className="yd-feas__consequence">
            Votre épargne recule au rythme mesuré. Vous pouvez tout de même poser la question
            ci-dessous : elle recevra une réponse chiffrée, et ce sera « hors de portée » tant que
            ce rythme ne change pas. Vos relevés sont complets — c'est bien ce qu'ils mesurent.
          </p>
        ) : null}
      </div>
    );
  }

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement de la faisabilité">
        <BentoCell span={SPAN.full} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--feas-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--feas-context" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.form} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--feas-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--feas-form" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.verdict} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--feas-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--feas-verdict" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (context === null) {
    body = null;
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Ce que vos relevés mesurent</h2>
          {renderContext(context)}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.form} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Votre achat</h2>
          <PurchaseForm
            key={reopened?.key ?? "new"}
            context={context}
            initial={reopened?.request ?? null}
            busy={busy}
            showLoa={showLoa}
            onToggleLoa={setShowLoa}
            onSubmit={(request) => void ask(request)}
          />
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.verdict}
          className={`yd-panel${busy ? " yd-panel--busy" : ""}`}
          aria-busy={busy}
          {...entryProps(reduced)}
        >
          {busy ? (
            <p className="yd-feas__busy">Calcul en cours…</p>
          ) : reportRefusal !== null ? (
            <>
              <h2 className="yd-panel__title">Verdict</h2>
              {/* A refusal from the engine, verbatim and in the panel's own
                  voice. Not an alert: nothing failed. */}
              <p className="yd-feas__refusal">{reportRefusal}</p>
            </>
          ) : report !== null ? (
            <VerdictPanel report={report} />
          ) : (
            <EmptyState
              title="Aucune question posée."
              detail="Renseignez un prix et une échéance à gauche. La réponse sera calculée à partir des rythmes mesurés ci-dessus, pas à partir de moyennes : si elle est négative, elle le dira."
            />
          )}
        </BentoCell>

        {report !== null && !busy ? (
          <>
            {/* EMPTY when the capacity could not be measured, and `LeverList`
                renders nothing on an empty list — so the cell itself is not
                mounted either, rather than shown as an empty card. */}
            {report.levers.length > 0 ? (
              <BentoCell
                as={motion.div}
                span={SPAN.full}
                className="yd-panel"
                {...entryProps(reduced)}
              >
                <h2 className="yd-panel__title">Ce qu'il faudrait changer</h2>
                <LeverList levers={report.levers} />
              </BentoCell>
            ) : null}

            <BentoCell
              as={motion.div}
              span={SPAN.full}
              className="yd-panel"
              {...entryProps(reduced)}
            >
              <h2 className="yd-panel__title">Comptant, crédit ou LOA</h2>
              <FinancingPanel
                financing={report.financing}
                loanRateBps={report.assumptions.loan_rate_bps}
                onAddLoa={() => setShowLoa(true)}
                cashOutOfReach={report.balance_cents < report.target_cents}
              />
            </BentoCell>

            <BentoCell
              as={motion.div}
              span={SPAN.half}
              className="yd-panel"
              {...entryProps(reduced)}
            >
              <h2 className="yd-panel__title">Ce que la possession coûte</h2>
              <OwnershipPanel
                ownership={report.ownership}
                opportunityCostCents={report.opportunity_cost_cents}
                opportunityHorizonMonths={report.opportunity_horizon_months}
              />
            </BentoCell>

            <BentoCell
              as={motion.div}
              span={SPAN.half}
              className="yd-panel"
              {...entryProps(reduced)}
            >
              <h2 className="yd-panel__title">Ce que cet achat change</h2>
              <ImpactPanel
                impact={report.impact}
                targetCents={report.target_cents}
                downPaymentCents={report.down_payment_cents}
              />
            </BentoCell>
          </>
        ) : null}

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Scénarios enregistrés</h2>
          {scenarioError !== null ? (
            <p role="alert" className="yd-feas__alert">
              {`Scénarios indisponibles : ${scenarioError}`}
            </p>
          ) : null}
          <ScenarioBar
            scenarios={scenarios}
            current={asked}
            onChanged={() => setScenarioToken((token) => token + 1)}
            onReopen={(request) => {
              setReopened({ request, key: Date.now() });
              setShowLoa(request.loa !== undefined && request.loa !== null);
              void ask(request);
            }}
          />
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-feas">
      <div className="yd-feas__header">
        <h1>Faisabilité d'achat</h1>
        <p className="yd-feas__lead">
          Puis-je m'offrir ce bien, et sinon que faut-il changer ?
        </p>
      </div>

      {contextError !== null ? (
        <p role="alert" className="yd-feas__alert">
          {`Faisabilité indisponible : ${contextError}`}
        </p>
      ) : null}

      {reportError !== null ? (
        <p role="alert" className="yd-feas__alert">
          {`Le calcul n'a pas abouti : ${reportError}`}
        </p>
      ) : null}

      {body}
    </section>
  );
}
