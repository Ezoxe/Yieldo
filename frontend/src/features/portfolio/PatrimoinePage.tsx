import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { EmptyState } from "../../design/EmptyState";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { api } from "../../lib/api";
import { messageFor } from "../../lib/refusal";
import type {
  Connection,
  InvestmentAccount,
  Lot,
  PortfolioAllocation,
  PortfolioValuation,
} from "../../lib/types";
import { AllocationPanel } from "./AllocationPanel";
import { HoldingsPanel } from "./HoldingsPanel";
import { MarketPanel } from "./MarketPanel";
import "./PatrimoinePage.css";
import { PortfolioEditor } from "./PortfolioEditor";
import { TotalPanel } from "./TotalPanel";
import { WeightsPanel } from "./WeightsPanel";

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the same cells at the same spans and nothing
 * moves when the data arrives.
 *
 * The holdings table spans the full width at every breakpoint: it carries six
 * columns and a narrow cell would either wrap them into an unreadable block or
 * push the page sideways. The total is the narrowest cell on the screen and
 * the market panel sits beside it — the figure is one number, and what the
 * screen has to say about how trustworthy it is takes more room than the
 * number itself.
 */
const SPAN = {
  full: { base: 1, md: 6, lg: 12 },
  total: { base: 1, md: 3, lg: 5 },
  market: { base: 1, md: 3, lg: 7 },
  half: { base: 1, md: 6, lg: 6 },
  // The empty screen drops the value cell entirely (see below), so the two
  // panels that DO have something to say share the row instead.
  emptySteps: { base: 1, md: 6, lg: 7 },
  emptyMarket: { base: 1, md: 6, lg: 5 },
} satisfies Record<string, BentoSpan>;

interface PatrimoineData {
  valuation: PortfolioValuation;
  allocation: PortfolioAllocation;
  connections: Connection[];
  /** The envelopes and the acquisitions, for the panel that declares them.
   *  Neither touches a market provider, so neither costs a quota call. */
  accounts: InvestmentAccount[];
  lots: Lot[];
}

export function PatrimoinePage() {
  const reduced = useReducedMotion();

  const [data, setData] = useState<PatrimoineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Bumped by every write the declaration panel makes. A new lot changes a
  // total, a weight and a drift at once, so the screen is reloaded whole
  // rather than patched in place — there is no version of this data that is
  // partly new and still coherent.
  const [reloadToken, setReloadToken] = useState(0);
  // Read ONCE per mount rather than per render: an age computed from a fresh
  // `new Date()` on every render would make the same stale price report a
  // different age each time React re-rendered, for no reason the reader could
  // see. It is also what lets the tests assert an age at all.
  const [now] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        // `/connections` is independent and NOT load-bearing: its failure
        // must not cost the household its portfolio, so it is absorbed here
        // and the market panel says the state could not be read.
        //
        // The valuation and the allocation, by contrast, are deliberately
        // SEQUENTIAL rather than raced. Both walk the same positions through
        // the same quota-aware client, so firing them together doubles the
        // provider calls a single page load costs, against a pool whose whole
        // purpose is to be spent sparingly; run in order, the second reads the
        // prices the first has just cached. It also removes a real collision:
        // on a cold database neither the `quota_windows` row nor the
        // `price_points` rows exist yet, and two requests inserting them at
        // once violated a unique constraint — a 500 on the very first load of
        // this screen, reproduced 5 times out of 5. The backend no longer
        // fails that way either (see `api/portfolio._valuation_inputs`), but
        // paying twice for one screen was never right regardless.
        const connectionsPromise = api
          .get<Connection[]>("/connections")
          .catch(() => [] as Connection[]);
        // Fired alongside, and deliberately NOT behind the two above: neither
        // reads a price, so neither consults the quota pool, and neither can
        // collide with the rows the valuation writes.
        const accountsPromise = api.get<InvestmentAccount[]>("/portfolio/accounts");
        const lotsPromise = api.get<Lot[]>("/portfolio/lots");
        const valuation = await api.get<PortfolioValuation>("/portfolio/valuation");
        const allocation = await api.get<PortfolioAllocation>("/portfolio/allocation");
        const connections = await connectionsPromise;
        const accounts = await accountsPromise;
        const lots = await lotsPromise;
        if (cancelled) return;
        setData({ valuation, allocation, connections, accounts, lots });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setData(null);
        setError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  let body: ReactNode;

  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement du patrimoine">
        <BentoCell span={SPAN.total} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--patrimoine-card" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.market} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--patrimoine-card" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.full} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--patrimoine-table" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (data === null) {
    body = null;
  } else {
    const { valuation, allocation, connections, accounts, lots } = data;
    const { total } = valuation;
    const declaredNothing = total.positions_total === 0;
    const incomplete = total.positions_missing_price + total.positions_missing_fx > 0;
    const reload = () => setReloadToken((token) => token + 1);

    // Full width at every breakpoint: it nests three levels (envelope,
    // position, lot) and holds forms two fields wide, neither of which fits a
    // half-width cell at 768.
    const editorCell = (
      <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
        <h2 className="yd-panel__title">Déclarer ce que vous détenez</h2>
        <PortfolioEditor
          accounts={accounts}
          positions={valuation.positions}
          lots={lots}
          onChanged={reload}
        />
      </BentoCell>
    );

    const marketCell = (
      <BentoCell
        as={motion.div}
        span={declaredNothing ? SPAN.emptyMarket : SPAN.market}
        className={`yd-panel${declaredNothing ? " yd-patrimoine__cell--fit" : ""}`}
        {...entryProps(reduced)}
      >
        <h2 className="yd-panel__title">Données de marché</h2>
        {connections.length === 0 ? (
          <p className="yd-patrimoine__alert" role="alert">
            L'état des connexions n'a pas pu être lu. Vos positions ci-dessous restent exactes —
            seule cette liste manque.
          </p>
        ) : (
          <MarketPanel connections={connections} />
        )}
      </BentoCell>
    );

    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        {declaredNothing ? (
          // **No "Valeur du portefeuille" cell at all.** An empty portfolio
          // genuinely is worth zero, but a display-size 0,00 € above a count
          // of "0 sur 0" tells a household starting out nothing, and a cell
          // holding only that stretches to its neighbour's height and leaves a
          // tall empty box — which is what the browser showed at 1440. The
          // panel below already states the same fact once, with the remedy
          // attached, so this state is the diagnosis and nothing else.
          <>
            <BentoCell
              as={motion.div}
              span={SPAN.emptySteps}
              className="yd-panel yd-patrimoine__cell--fit"
              {...entryProps(reduced)}
            >
              <h2 className="yd-panel__title">Vos positions</h2>
              <EmptyState
                title="Aucune position déclarée."
                detail="Yieldo ne valorise que ce que vous lui déclarez : il ne se connecte à aucun courtier et ne découvre rien tout seul. Une position se déclare en trois temps, et chacun répond à une question différente."
              >
                <ol className="yd-patrimoine__steps">
                  <li>
                    <strong>Un compte d'investissement</strong> — PEA, CTO, assurance-vie, PER ou
                    compte d'échange. C'est l'enveloppe, et sa date d'ouverture décide seule des
                    règles fiscales qui s'y appliqueront.
                  </li>
                  <li>
                    <strong>Un instrument</strong> — le symbole coté et sa classe d'actifs. C'est
                    ce qu'un fournisseur de données saura valoriser, si une clé est enregistrée.
                  </li>
                  <li>
                    <strong>Un lot par acquisition</strong> — la quantité, le prix unitaire payé
                    et la date. Yieldo ne stocke jamais un total : la position, c'est la somme de
                    ses lots, et c'est ce qui rendra possible le calcul des plus-values, lot par
                    lot.
                  </li>
                </ol>
              </EmptyState>
            </BentoCell>
            {marketCell}
            {editorCell}
          </>
        ) : (
          <>
            <BentoCell
              as={motion.div}
              span={SPAN.total}
              className="yd-panel"
              {...entryProps(reduced)}
            >
              <h2 className="yd-panel__title">Valeur du portefeuille</h2>
              <TotalPanel total={total} reportingCurrency={valuation.reporting_currency} />
            </BentoCell>

            {marketCell}

            <BentoCell
              as={motion.div}
              span={SPAN.full}
              className="yd-panel"
              {...entryProps(reduced)}
            >
              <h2 className="yd-panel__title">Vos positions</h2>
              <HoldingsPanel
                positions={valuation.positions}
                reportingCurrency={valuation.reporting_currency}
                now={now}
              />
            </BentoCell>

            <BentoCell
              as={motion.div}
              span={SPAN.half}
              className="yd-panel"
              {...entryProps(reduced)}
            >
              <h2 className="yd-panel__title">Répartition par classe d'actifs</h2>
              <WeightsPanel
                groups={valuation.weight_by_asset_class}
                dimension="asset_class"
                incomplete={incomplete}
              />
            </BentoCell>

            <BentoCell
              as={motion.div}
              span={SPAN.half}
              className="yd-panel"
              {...entryProps(reduced)}
            >
              <h2 className="yd-panel__title">Répartition par devise</h2>
              <WeightsPanel
                groups={valuation.weight_by_currency}
                dimension="currency"
                incomplete={incomplete}
              />
            </BentoCell>

            {editorCell}
          </>
        )}

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Allocation cible et écart</h2>
          <AllocationPanel allocation={allocation} onSaved={reload} />
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-patrimoine">
      <div className="yd-patrimoine__header">
        <h1>Patrimoine</h1>
        <p className="yd-patrimoine__lead">
          Ce que vous détenez, ce que Yieldo a pu valoriser, et ce qu'il n'a pas pu — nommément.
          Un prix manquant n'est jamais remplacé par un zéro ni par le prix payé, et un prix daté
          est affiché avec son âge plutôt que présenté comme frais.
        </p>
      </div>

      {error !== null ? (
        <p role="alert" className="yd-patrimoine__alert">
          {`Patrimoine indisponible : ${error}`}
        </p>
      ) : null}

      {body}
    </section>
  );
}
