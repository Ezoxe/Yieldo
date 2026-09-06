import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { Drawer } from "../../design/Drawer";
import {
  AlertsIcon,
  CalendarIcon,
  ChevronIcon,
  ListIcon,
  PlusIcon,
  RecurrencesIcon,
} from "../../design/icons";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type {
  Account,
  Category,
  DeclaredRecurrence,
  Occurrence,
  RecurrenceCalendar as CalendarBody,
  ScheduleCost,
} from "../../lib/types";
import { DeclarationForm, type DeclarationDraft, PERIODICITY_OPTIONS } from "./DeclarationForm";
import { RecurrenceCalendar, STATUS_LABEL, occurrenceKey } from "./RecurrenceCalendar";
import "./DeclaredRecurrences.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

const SPAN = {
  totals: { base: 1, md: 6, lg: 4 } satisfies BentoSpan,
  calendar: { base: 1, md: 6, lg: 8 } satisfies BentoSpan,
  list: { base: 1, md: 6, lg: 12 } satisfies BentoSpan,
};

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** The first and last day of a month, in the `YYYY-MM-DD` the API speaks. */
export function monthBounds(year: number, month: number): [string, string] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return [`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(last)}`];
}

/**
 * What a declaration's cost line says about its own authority.
 *
 * A variable charge is declared as an estimate and billed as something else.
 * Until three due dates have been ticked off, the figure on screen is the
 * household's own guess, and saying so is the difference between a measurement
 * and a number that merely looks like one. Exported so the test reads the same
 * sentence the reader does.
 */
export function basisNote(cost: ScheduleCost, isVariable: boolean): string | null {
  if (!isVariable) return null;
  if (cost.amount_basis === "observed") {
    return `Mesuré sur ${cost.observations} ${plural(cost.observations, "échéance pointée", "échéances pointées")}.`;
  }
  return (
    `Estimation : ${cost.observations} ${plural(cost.observations, "échéance pointée", "échéances pointées")}` +
    " — il en faut trois pour que Yieldo compte ce que vous payez vraiment."
  );
}

interface DeclaredRecurrencesProps {
  categories: Category[];
  accounts: Account[];
}

export function DeclaredRecurrences({ categories, accounts }: DeclaredRecurrencesProps) {
  const reduced = useReducedMotion();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [declarations, setDeclarations] = useState<DeclaredRecurrence[]>([]);
  const [calendar, setCalendar] = useState<CalendarBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<DeclaredRecurrence | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    const [from, to] = monthBounds(year, month);
    try {
      const [rows, body] = await Promise.all([
        api.get<DeclaredRecurrence[]>("/recurrences/declared"),
        api.get<CalendarBody>("/recurrences/calendar", { date_from: from, date_to: to }),
      ]);
      setDeclarations(rows);
      setCalendar(body);
      setError(null);
    } catch (err) {
      setError(messageFor(err));
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  function shiftMonth(delta: number) {
    const next = month + delta;
    if (next < 1) {
      setMonth(12);
      setYear(year - 1);
    } else if (next > 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(next);
    }
  }

  async function handleToggle(occurrence: Occurrence) {
    const key = occurrenceKey(occurrence);
    setPending(key);
    try {
      if (occurrence.status === "pointed") {
        await api.delete(
          `/recurrences/declared/${occurrence.schedule_id}/checkins/${occurrence.due_on}`,
        );
      } else {
        await api.post(`/recurrences/declared/${occurrence.schedule_id}/checkins`, {
          due_on: occurrence.due_on,
        });
      }
      await load();
      setError(null);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(null);
    }
  }

  async function handleSubmit(draft: DeclarationDraft) {
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/recurrences/declared/${editing.id}`, draft);
      } else {
        await api.post("/recurrences/declared", draft);
      }
      setFormOpen(false);
      setEditing(null);
      await load();
      setError(null);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(declaration: DeclaredRecurrence) {
    try {
      await api.delete(`/recurrences/declared/${declaration.id}`);
      await load();
      setError(null);
    } catch (err) {
      setError(messageFor(err));
    }
  }

  const costs = new Map((calendar?.schedules ?? []).map((c) => [c.schedule_id, c]));

  return (
    <section className="yd-declared" aria-labelledby="yd-declared-title">
      <div className="yd-declared__head">
        <h2 id="yd-declared-title">Vos récurrences déclarées</h2>
        <p>
          Ce que vous savez payer, que vos relevés le montrent ou non. L'eau et
          l'électricité changent de montant à chaque facture : c'est précisément ce que la
          détection automatique, plus bas, ne peut pas voir.
        </p>
        <button
          type="button"
          className="yd-declared__add"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <PlusIcon aria-hidden="true" />
          Déclarer une récurrence
        </button>
      </div>

      {/* `role="status"` and not `role="alert"`: this section is one of two on
          the screen, both loading independently, and two shouting banners for
          one outage reads as two separate faults. The detection half above
          owns the assertive announcement. */}
      {error !== null ? (
        <p className="yd-declared__error" role="status">
          {error}
        </p>
      ) : null}

      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.totals}
          className="yd-panel"
          data-ai-target="panel-engagements"
          {...entryProps(reduced)}
        >
          <PanelHead icon={RecurrencesIcon}>Ce que vous vous êtes engagé à payer</PanelHead>
          {/* A zero is a claim, and it is never the claim this panel means: an
              empty total says "you have declared nothing", not "your charges
              cost nothing". Charges and income are also never netted into one
              figure -- a declared salary would otherwise hide a declared rent
              inside a comfortable total. */}
          {calendar !== null && calendar.annual_charges_cents !== 0 ? (
            <>
              <p className="yd-declared__figure yd-num">
                {formatCents(Math.abs(calendar.annual_charges_cents))}
              </p>
              <p className="yd-declared__figure-note">
                {`par an, soit ${formatCents(Math.abs(calendar.monthly_charges_cents))} par mois`}
              </p>
            </>
          ) : (
            <p className="yd-declared__uncomputable">Rien de déclaré à payer</p>
          )}
          {calendar !== null && calendar.annual_income_cents > 0 ? (
            <p className="yd-declared__figure-note">
              {`Et ${formatCents(calendar.annual_income_cents)} de revenus déclarés par an, comptés à part.`}
            </p>
          ) : null}
          {calendar?.notice !== null && calendar !== null ? (
            <p className="yd-declared__notice">{calendar.notice}</p>
          ) : null}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.calendar}
          className="yd-panel"
          data-ai-target="panel-calendrier-echeances"
          {...entryProps(reduced)}
        >
          <PanelHead icon={CalendarIcon}>Calendrier des échéances</PanelHead>

          <div className="yd-declared__monthbar">
            <button
              type="button"
              aria-label="Mois précédent"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronIcon aria-hidden="true" className="yd-declared__chevron--prev" />
            </button>
            <span className="yd-declared__month">{`${MONTHS[month - 1]} ${year}`}</span>
            <button type="button" aria-label="Mois suivant" onClick={() => shiftMonth(1)}>
              <ChevronIcon aria-hidden="true" />
            </button>
          </div>

          {calendar !== null && calendar.late_count > 0 ? (
            <p className="yd-declared__late" role="status">
              <AlertsIcon aria-hidden="true" />
              {`${calendar.late_count} ${plural(calendar.late_count, "échéance passée sans être pointée", "échéances passées sans être pointées")}.`}
            </p>
          ) : null}

          <RecurrenceCalendar
            year={year}
            month={month}
            occurrences={calendar?.occurrences ?? []}
            onToggle={handleToggle}
            pending={pending}
          />
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.list}
          className="yd-panel"
          data-ai-target="panel-declarations"
          {...entryProps(reduced)}
        >
          <PanelHead icon={ListIcon}>Vos déclarations</PanelHead>
          {declarations.length === 0 ? (
            <p className="yd-declared__notice">
              Rien de déclaré pour l'instant. Commencez par votre loyer et vos abonnements :
              ce sont eux qui reviennent tous les mois sans que personne ne les regarde.
            </p>
          ) : (
            <ul className="yd-declared__list">
              {declarations.map((declaration) => {
                const cost = costs.get(declaration.id);
                const note = cost ? basisNote(cost, declaration.amount_is_variable) : null;
                return (
                  <li key={declaration.id} className="yd-declared__row">
                    <div className="yd-declared__row-main">
                      <span className="yd-declared__row-label">{declaration.label}</span>
                      <span className="yd-declared__row-rhythm">
                        {PERIODICITY_OPTIONS[declaration.periodicity]}
                        {declaration.active ? "" : " — inactive"}
                      </span>
                      {note !== null ? (
                        <span className="yd-declared__row-basis">{note}</span>
                      ) : null}
                    </div>
                    <span
                      className={`yd-num yd-declared__row-amount ${
                        (cost?.amount_cents ?? declaration.amount_cents) > 0
                          ? "yd-amount--positive"
                          : "yd-amount--negative"
                      }`}
                    >
                      {formatCents(cost?.amount_cents ?? declaration.amount_cents)}
                    </span>
                    <div className="yd-declared__row-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(declaration);
                          setFormOpen(true);
                        }}
                      >
                        {`Modifier ${declaration.label}`}
                      </button>
                      <button
                        type="button"
                        className="yd-declared__row-delete"
                        onClick={() => void handleDelete(declaration)}
                      >
                        {`Supprimer ${declaration.label}`}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </BentoCell>
      </BentoGrid>

      <Drawer
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        title={editing ? "Modifier la récurrence" : "Déclarer une récurrence"}
        icon={RecurrencesIcon}
        subtitle={
          editing
            ? `${editing.label} — ${PERIODICITY_OPTIONS[editing.periodicity]}`
            : "Un abonnement, un loyer, une facture d'énergie"
        }
      >
        <DeclarationForm
          key={editing?.id ?? "new"}
          initial={editing}
          categories={categories}
          accounts={accounts}
          busy={busy}
          onSubmit={(draft) => void handleSubmit(draft)}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      </Drawer>
    </section>
  );
}

export { STATUS_LABEL };
