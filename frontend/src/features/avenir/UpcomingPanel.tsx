import { useState, type FormEvent } from "react";

import { PanelHead } from "../../design/bento/PanelHead";
import { CalendarIcon, PlusIcon, TrashIcon } from "../../design/icons";
import { formatCents, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { Outlook, OutlookEvent, OutlookSource } from "../../lib/types";
import { dayLabel } from "./answers";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";
const WINDOW_DAYS = 30;

const SOURCE_LABEL: Record<OutlookSource, string> = {
  detected: "détecté",
  declared: "déclaré",
  planned: "prévu",
  scenario: "scénario",
};

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the week `iso` falls in, as ISO. */
function weekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
}

function plannedId(event: OutlookEvent): number | null {
  return event.source === "planned" ? Number(event.series.split(":")[1]) : null;
}

/**
 * The next thirty days, week by week: every known event with where it comes
 * from and the balance right after it, the variable spending per day, the
 * warnings about declarations, and the one-off events the household adds here.
 */
export function UpcomingPanel({ outlook, onChanged }: {
  outlook: Outlook;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [amount, setAmount] = useState("");
  const [income, setIncome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const until = addDays(outlook.as_of, WINDOW_DAYS);
  const upcoming = outlook.events.filter((event) => event.on <= until);
  const weeks = new Map<string, OutlookEvent[]>();
  for (const event of upcoming) {
    const key = weekStart(event.on);
    weeks.set(key, [...(weeks.get(key) ?? []), event]);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const cents = parseCents(amount);
    if (cents === null || cents === 0) {
      setError("Montant illisible : écrivez-le en euros, par exemple 1 800 ou 42,50.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/planned-events", {
        label: label.trim(),
        due_on: dueOn,
        amount_cents: income ? Math.abs(cents) : -Math.abs(cents),
      });
      setAdding(false);
      setLabel("");
      setDueOn("");
      setAmount("");
      setIncome(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setError(null);
    try {
      await api.delete(`/planned-events/${id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    }
  }

  return (
    <div className="yd-upcoming">
      <PanelHead icon={CalendarIcon}
        subtitle={`Du ${dayLabel(addDays(outlook.as_of, 1))} au ${dayLabel(until)}`}>
        Les 30 prochains jours
      </PanelHead>

      {outlook.warnings.map((warning) => (
        <p key={warning} className="yd-upcoming__warning">{warning}</p>
      ))}

      {upcoming.length === 0 ? (
        <p className="yd-avenir__sub">Aucune échéance connue sur les trente prochains jours.</p>
      ) : (
        [...weeks.entries()].map(([week, events]) => (
          <section key={week} className="yd-upcoming__week" aria-label={`Semaine du ${dayLabel(week)}`}>
            <h3 className="yd-upcoming__heading">Semaine du {dayLabel(week)}</h3>
            <ul className="yd-upcoming__list">
              {events.map((event, index) => {
                const id = plannedId(event);
                return (
                  <li key={`${event.series}-${event.on}-${index}`} className="yd-upcoming__row">
                    <span className="yd-upcoming__date">{dayLabel(event.on)}</span>
                    <span className="yd-upcoming__label">
                      <span>{event.label}</span>
                      <span className={`yd-upcoming__source yd-upcoming__source--${event.source}`}>
                        {SOURCE_LABEL[event.source]}
                      </span>
                    </span>
                    <span className={`yd-num yd-upcoming__amount${event.amount_cents > 0 ? " is-income" : ""}`}>
                      {formatCents(event.amount_cents, { signed: true })}
                    </span>
                    <span className="yd-num yd-upcoming__after" title="Solde prévu après ce jour">
                      {formatCents(event.balance_after_cents, { signed: true })}
                    </span>
                    {id !== null ? (
                      <button type="button" className="yd-upcoming__remove"
                        aria-label={`Supprimer l'événement ${event.label}`}
                        onClick={() => void remove(id)}>
                        <TrashIcon />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {outlook.variable_daily_cents !== null ? (
        <p className="yd-avenir__sub">
          Dépenses courantes ≈ {formatCents(Math.abs(outlook.variable_daily_cents), { decimals: 0 })} par
          jour, mesurées sur vos relevés et comprises dans la courbe.
        </p>
      ) : null}

      {error !== null ? <p role="alert" className="yd-avenir__error">{error}</p> : null}

      {adding ? (
        <form className="yd-upcoming__form" onSubmit={(event) => void add(event)}>
          <label className="yd-upcoming__field">
            <span>Libellé</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} required
              maxLength={120} placeholder="Solde d'impôt, vacances, prime…" />
          </label>
          <label className="yd-upcoming__field">
            <span>Date</span>
            <input type="date" value={dueOn} min={addDays(outlook.as_of, 1)}
              onChange={(event) => setDueOn(event.target.value)} required />
          </label>
          <label className="yd-upcoming__field">
            <span>Montant (€)</span>
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
              required />
          </label>
          <label className="yd-upcoming__check">
            <input type="checkbox" checked={income} onChange={(event) => setIncome(event.target.checked)} />
            C'est une rentrée d'argent
          </label>
          <div className="yd-upcoming__actions">
            <button type="submit" className="yd-upcoming__submit" disabled={busy}>Ajouter</button>
            <button type="button" className="yd-upcoming__cancel" onClick={() => setAdding(false)}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="yd-upcoming__add" onClick={() => setAdding(true)}>
          <PlusIcon />
          Ajouter un événement prévu
        </button>
      )}
    </div>
  );
}
