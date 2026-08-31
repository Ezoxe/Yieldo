import { motion } from "motion/react";
import { useId, useRef, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { CreditSimulator } from "./CreditSimulator";
import { SavingsSimulator } from "./SavingsSimulator";
import "./SimulatorsPage.css";

/** The tab identities, and the only values `?onglet=` may hold. */
const TABS = [
  { key: "credit", label: "Crédit", title: "Simuler un crédit" },
  { key: "epargne", label: "Épargne", title: "Simuler une épargne" },
  { key: "immobilier", label: "Immobilier", title: "Simuler un achat immobilier" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const SPAN = {
  full: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

/** The URL's `?onglet=`, or the first tab. An unrecognised value falls back
 *  rather than rendering an empty panel: a hand-edited or stale link should
 *  land somewhere, and "poney" is not a simulator. */
function activeTab(raw: string | null): TabKey {
  return TABS.some((tab) => tab.key === raw) ? (raw as TabKey) : "credit";
}

/**
 * Crédit, épargne, immobilier — the three "et si" questions.
 *
 * The active tab lives in the query string rather than in component state, so a
 * reload keeps it and a tab can be linked to (the browser gate opens
 * `?onglet=immobilier` directly). `replace: true` on the write: switching tabs
 * is not a navigation a reader wants to walk back through one press of the back
 * button at a time.
 *
 * Only the active panel is mounted. Each simulator owns a form and, once
 * answered, an ECharts canvas; keeping three of those alive to preserve typing
 * nobody has submitted would cost more than it saves.
 */
export function SimulatorsPage() {
  const reduced = useReducedMotion();
  const baseId = useId();
  const [params, setParams] = useSearchParams();
  const active = activeTab(params.get("onglet"));
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabId = (key: string) => `${baseId}-tab-${key}`;
  const panelId = (key: string) => `${baseId}-panel-${key}`;

  function select(key: TabKey) {
    const next = new URLSearchParams(params);
    next.set("onglet", key);
    setParams(next, { replace: true });
  }

  /**
   * Arrow keys walk the tablist and select as they go, Home/End jump to the
   * ends, and both wrap. This is the WAI-ARIA "tabs with automatic activation"
   * pattern; the roving `tabIndex` below is its other half — without it, Tab
   * would stop on all three tabs and the arrow keys would be decoration.
   */
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((tab) => tab.key === active);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const key = TABS[next].key;
    select(key);
    tabRefs.current[key]?.focus();
  }

  return (
    <section className="yd-sims">
      <div className="yd-sims__header">
        <h1>Simulateurs</h1>
        <p className="yd-sims__lead" data-testid="yd-sim-lead">
          {"Ces simulateurs répondent à « et si ? », à partir des chiffres que vous tapez. Pour « puis-je ? », à partir des rythmes mesurés dans vos relevés, c'est l'écran "}
          <Link className="yd-sims__link" to="/faisabilite">
            Faisabilité d'achat
          </Link>
          {" qui répond. Les deux se ressemblent et ne disent pas la même chose : ici rien n'est mesuré, tout est supposé."}
        </p>
      </div>

      <div className="yd-sims__tabs" role="tablist" aria-label="Simulateurs">
        {TABS.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={tabId(tab.key)}
              aria-selected={selected}
              aria-controls={panelId(tab.key)}
              tabIndex={selected ? 0 : -1}
              ref={(node) => {
                tabRefs.current[tab.key] = node;
              }}
              className={`yd-sims__tab${selected ? " yd-sims__tab--active" : ""}`}
              onClick={() => select(tab.key)}
              onKeyDown={onKeyDown}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <BentoGrid as={motion.div} key={active} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.full}
          className="yd-panel"
          role="tabpanel"
          id={panelId(active)}
          aria-labelledby={tabId(active)}
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">
            {TABS.find((tab) => tab.key === active)?.title}
          </h2>
          {active === "credit" ? (
            <CreditSimulator />
          ) : active === "epargne" ? (
            <SavingsSimulator />
          ) : (
            <p className="yd-sim__refusal">
              Le simulateur immobilier n'est pas encore branché sur cet écran. Rien n'est affiché à
              sa place — un formulaire vide se lirait comme un outil qui ne répond pas.
            </p>
          )}
        </BentoCell>
      </BentoGrid>
    </section>
  );
}
