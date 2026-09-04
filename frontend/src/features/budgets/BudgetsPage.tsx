import { motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { CountUp } from "../../design/CountUp";
import { EmptyState, historySentence } from "../../design/EmptyState";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { formatCents, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { BudgetReport } from "../../lib/types";
import { BudgetsIcon, CalendarIcon, ChevronIcon, ListIcon, PlusIcon } from "../../design/icons";
import { Swap } from "../../design/motion/Swap";
import { PageHead } from "../../design/PageHead";
import { BudgetBar } from "./BudgetBar";
import "./BudgetsPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

/**
 * The month arrows. One glyph, mirrored — `design/icons` owns the drawing, and
 * a second copy of it here is how two chevrons in one application end up on two
 * different grids. Rotated in CSS rather than redrawn (see `--yd-flip`).
 */
function MonthArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <span className={`yd-budgets__arrow yd-budgets__arrow--${direction}`}>
      <ChevronIcon />
    </span>
  );
}

/** "2026-01" → "janvier 2026". The month key is the API's, the words are ours. */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The month `offset` months away from `key`, in the same "AAAA-MM" shape. */
export function shiftMonth(key: string, offset: number): string {
  const [year, month] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the *same* cells at the same spans and
 * nothing moves when the data arrives.
 *
 * At lg (12 columns): the month's totals across the top, then the budget bars
 * (7) beside the categories still waiting for a ceiling (5). The bars are the
 * wider of the two because they are what the reader came for; the right-hand
 * column is the way to add more of them.
 */
const SPAN = {
  summary: { base: 1, md: 6, lg: 12 },
  lines: { base: 1, md: 6, lg: 7 },
  unbudgeted: { base: 1, md: 6, lg: 5 },
  empty: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

interface BudgetInputProps {
  categoryId: number;
  name: string;
  spentCents: number;
  onSaved: () => void;
}

/**
 * One "set a budget" row. The euro figure typed here becomes integer cents
 * through `parseCents`, which returns null rather than 0 on anything it cannot
 * read exactly -- a silent 0 would set a budget of nothing and mark the
 * category permanently over.
 *
 * Both ways a save can fail -- an unreadable amount, and a rejection from the
 * backend -- are reported *here*, under the field that caused them. Sent up to
 * the page-level alert instead they landed above the bento grid, which at 375px
 * is several screens above this input: the operator saw the button re-enable
 * and nothing else change. Only a failed *load* has no field to attach to, and
 * that one is still the page's to report.
 */
/**
 * A ceiling to propose for a category that has none, from the one figure this
 * screen actually has: what the category cost this month, rounded up to the
 * next ten euros.
 *
 * Deliberately NOT called an average — it is a single month, and the panel
 * says so on screen. A suggestion drawn from one observation is still a better
 * starting point than an empty field; claiming it is a mean would not be.
 */
export function suggestedCeiling(spentCents: number): string {
  const euros = Math.abs(spentCents) / 100;
  const rounded = Math.max(10, Math.ceil(euros / 10) * 10);
  return String(rounded);
}

function BudgetInput({ categoryId, name, spentCents, onSaved }: BudgetInputProps) {
  // Collapsed until asked for. A text field and a "Définir" button on every
  // row turned this panel into an unfinished spreadsheet — twelve inputs
  // nobody was filling in. The row now states what the category cost and
  // offers one discreet way to give it a ceiling.
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Category ids are unique across this list, so this needs no useId.
  const errorId = `yd-budget-error-${categoryId}`;

  function open() {
    // Pre-filled with the suggestion rather than with nothing: an empty field
    // asks the operator to invent a number, and the one number they have is
    // right there on the row.
    setValue(suggestedCeiling(spentCents));
    setEditing(true);
  }

  async function save() {
    const cents = parseCents(value);
    if (cents === null || cents <= 0) {
      setError("Montant invalide : saisissez un montant en euros, par exemple 250,50.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/categories/${categoryId}`, { monthly_budget_cents: cents });
      onSaved();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="yd-budgets__suggestion">
      <span className="yd-budgets__suggestion-name">{name}</span>
      <span className="yd-budgets__suggestion-spent yd-num">
        {formatCents(Math.abs(spentCents))}
      </span>

      {editing ? (
        <>
          <label className="yd-budgets__suggestion-field">
            <span className="sr-only">{`Budget mensuel pour ${name}`}</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              aria-label={`Budget mensuel pour ${name}`}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? errorId : undefined}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                // What was typed is what was rejected; once it changes, the
                // message no longer describes the field it sits under.
                if (error !== null) setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
                if (event.key === "Escape") setEditing(false);
              }}
              placeholder="250,00"
            />
          </label>
          <button
            type="button"
            className="yd-budgets__suggestion-save"
            disabled={saving}
            onClick={() => void save()}
          >
            <span className="sr-only">{`Enregistrer le budget de ${name}`}</span>
            <span aria-hidden="true">Définir</span>
          </button>
        </>
      ) : (
        <button type="button" className="yd-budgets__suggestion-open" onClick={open}>
          <PlusIcon />
          <span className="sr-only">{`Fixer un seuil pour ${name}`}</span>
          <span aria-hidden="true">Fixer un seuil</span>
        </button>
      )}

      {error !== null ? (
        <p id={errorId} role="alert" className="yd-budgets__suggestion-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function BudgetsPage() {
  const [params, setParams] = useSearchParams();
  const reduced = useReducedMotion();
  const askedMonth = params.get("mois");

  const [report, setReport] = useState<BudgetReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  // The month this screen is already showing (or already asking for). A change
  // of month is a navigation and earns the skeleton; a save re-asks for the
  // month already on screen and must NOT, because swapping the grid for the
  // skeleton unmounts every `BudgetInput` on it and throws away what the
  // operator has typed into the ones he has not saved yet. Setting three
  // budgets in a row is this screen's core interaction.
  const shownMonth = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const isNavigation = shownMonth.current !== askedMonth;
    shownMonth.current = askedMonth;
    async function load() {
      if (isNavigation) setIsLoading(true);
      try {
        // No `month` at all on the first visit: the backend then resolves it to
        // the month of the user's *latest* transaction, not to today's. The
        // operator's statements stop months before today, and opening this
        // screen on a permanently empty month is the defect this avoids.
        const body = await api.get<BudgetReport>("/budgets", { month: askedMonth ?? undefined });
        if (cancelled) return;
        setReport(body);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setReport(null);
        setError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [askedMonth, reloadToken]);

  // Which way the last month change went, so the content slides in from the
  // side the reader came from. A ref, not state: it is read during the render
  // that follows the change and must never cause one of its own.
  const direction = useRef<1 | -1>(1);
  const goToMonth = useCallback(
    (key: string) => {
      direction.current = key > (askedMonth ?? "") ? 1 : -1;
      setParams({ mois: key });
    },
    [askedMonth, setParams],
  );

  // The URL first, the loaded report only as a fallback. `report` lags a click
  // behind -- it is not cleared while the next month is in flight -- so reading
  // the month off it made the header sit on the *previous* month for the whole
  // load, and made a second click on "Mois précédent" recompute from that stale
  // month and ask for the one already being fetched. With no `?mois=` at all
  // (the first visit) there is nothing to read but the report, which is exactly
  // the month the backend resolved to the user's latest transaction.
  const current = askedMonth ?? report?.month ?? "";
  const overCount = report?.lines.filter((line) => line.status === "over").length ?? 0;
  const atRiskCount = report?.lines.filter((line) => line.status === "at_risk").length ?? 0;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement des budgets">
        <BentoCell span={SPAN.summary} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--budget-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--budget-totals" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.lines} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--budget-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--budget-list" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.unbudgeted} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--budget-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--budget-suggestions" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (report === null) {
    body = null;
  } else if (report.lines.length === 0 && report.unbudgeted.length === 0) {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.empty} {...entryProps(reduced)}>
          {report.history === null ? (
            <EmptyState
              title="Aucun budget défini, et aucune dépense à budgéter."
              detail="Importez un relevé bancaire : les catégories sur lesquelles vous dépensez apparaîtront ici, prêtes à recevoir un plafond."
            >
              <Link to="/import" className="yd-empty__action">
                Importer un relevé
              </Link>
            </EmptyState>
          ) : (
            <EmptyState
              title="Aucun budget défini, et aucune dépense ce mois-ci."
              detail={historySentence(report.history)}
            >
              <button
                type="button"
                className="yd-empty__action"
                onClick={() => goToMonth(report.history!.date_to.slice(0, 7))}
              >
                Aller au dernier mois avec des données
              </button>
            </EmptyState>
          )}
        </BentoCell>
      </BentoGrid>
    );
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.summary} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={CalendarIcon}>Ce mois-ci</PanelHead>
          <div className="yd-budgets__totals">
            <div className="yd-budgets__total">
              <span className="yd-budgets__total-label">Budgété</span>
              <CountUp
                value={report.total_budget_cents}
                format={(cents) => formatCents(cents)}
                className="yd-budgets__total-value"
              />
            </div>
            <div className="yd-budgets__total">
              <span className="yd-budgets__total-label">Dépensé</span>
              <CountUp
                value={Math.abs(report.total_spent_cents)}
                format={(cents) => formatCents(cents)}
                className="yd-budgets__total-value"
              />
            </div>
            <p className="yd-budgets__verdict">
              {overCount === 0 && atRiskCount === 0
                ? "Aucun budget dépassé."
                : [
                    overCount > 0
                      ? `${overCount} ${plural(overCount, "budget dépassé", "budgets dépassés")}`
                      : "",
                    atRiskCount > 0
                      ? `${atRiskCount} ${plural(atRiskCount, "budget en passe de l'être", "budgets en passe de l'être")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(", ") + "."}
            </p>
            {!report.is_current_month ? (
              // A finished month has no pace to project, and saying so is
              // better than leaving the reader wondering why no projection
              // appears on any line.
              <p className="yd-budgets__note">
                Mois terminé : les montants affichés sont définitifs, aucune projection n'est faite.
              </p>
            ) : (
              <p className="yd-budgets__note">
                {`Mois en cours, ${report.days_elapsed} ${plural(report.days_elapsed, "jour écoulé", "jours écoulés")} sur ${report.days_in_month}.`}
              </p>
            )}
          </div>
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.lines}
          data-ai-target="panel-budgets" className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={BudgetsIcon}>Budgets par catégorie</PanelHead>
          {report.lines.length === 0 ? (
            // Named, not placed: `SPAN.unbudgeted` is `{ base: 1, md: 6 }`, so
            // "Sans budget" is only to the right of this panel from 1200px up.
            // At 375 and at 768 it is stacked underneath.
            <p className="yd-budgets__none">
              Aucun budget défini. Choisissez une catégorie dans « Sans budget » pour commencer.
            </p>
          ) : (
            <div className="yd-budgets__list">
              {report.lines.map((line) => (
                <BudgetBar key={line.category_id} line={line} />
              ))}
            </div>
          )}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.unbudgeted}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <PanelHead icon={ListIcon}>Sans budget</PanelHead>
          {report.unbudgeted.length === 0 ? (
            <p className="yd-budgets__none">
              Chaque catégorie sur laquelle vous avez dépensé a un budget.
            </p>
          ) : (
            <ul className="yd-budgets__suggestions">
              {report.unbudgeted.map((entry) => (
                <BudgetInput
                  key={entry.category_id}
                  categoryId={entry.category_id}
                  name={entry.name}
                  spentCents={entry.spent_cents}
                  onSaved={() => setReloadToken((token) => token + 1)}
                />
              ))}
            </ul>
          )}
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-budgets">
      <PageHead
        icon={BudgetsIcon}
        title="Budgets"
        className="yd-budgets__header"
        actions={
          <div className="yd-budgets__month-nav">
          <button
            type="button"
            onClick={() => goToMonth(shiftMonth(current, -1))}
            disabled={!current}
          >
            <span className="sr-only">Mois précédent</span>
            <MonthArrow direction="left" />
          </button>
          <span className="yd-budgets__month" aria-live="polite">
            {current ? monthLabel(current) : ""}
          </span>
          <button
            type="button"
            onClick={() => goToMonth(shiftMonth(current, 1))}
            disabled={!current}
          >
            <span className="sr-only">Mois suivant</span>
            <MonthArrow direction="right" />
          </button>
          </div>
        }
      >
        <p className="yd-budgets__lead">
          Ce que chaque catégorie a consommé de son enveloppe ce mois-ci, et ce qu'il en
          reste.
        </p>
      </PageHead>

      {error !== null ? (
        <p role="alert" className="yd-budgets__alert">
          {error}
        </p>
      ) : null}

      {/* The month is what this whole screen shows, so a change of month is a
          change of content, not a repaint: it leaves towards the month the
          reader came from and the new one arrives from the other side. */}
      <Swap swapKey={current || "chargement"} direction={direction.current}>
        {body}
      </Swap>
    </section>
  );
}
