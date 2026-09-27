import { useEffect, useState, type FormEvent } from "react";

import { PanelHead } from "../../design/bento/PanelHead";
import { ProjectionIcon } from "../../design/icons";
import { formatCents, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type {
  Outlook,
  OutlookAdjustment,
  OutlookScenario,
  OutlookScope,
} from "../../lib/types";
import { dayLabel } from "./answers";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";
// Typing a date or an amount is several keystrokes; one request per pause.
const DEBOUNCE_MS = 300;

type Kind = "expense" | "income" | "cancel" | "change";

const KINDS: { value: Kind; label: string }[] = [
  { value: "expense", label: "Dépense ponctuelle" },
  { value: "income", label: "Revenu ponctuel" },
  { value: "cancel", label: "Résilier…" },
  { value: "change", label: "Changer un montant…" },
];

interface Change {
  adjustment: OutlookAdjustment;
  // What the list prints and the buttons are named after.
  title: string;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * « Et si… » : a scenario built change by change, computed by the backend on
 * the same projection (POST /outlook/scenario) and never saved -- except a
 * one-off change the household decides to keep as a planned event.
 */
export function ScenarioPanel({ outlook, scope, horizonDays, onScenario, onSaved }: {
  outlook: Outlook;
  scope: OutlookScope;
  horizonDays: number;
  onScenario: (scenario: Outlook | null) => void;
  onSaved: () => void;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [open, setOpen] = useState<Kind | null>(null);
  const [label, setLabel] = useState("");
  const [on, setOn] = useState(addDays(outlook.as_of, 1));
  const [amount, setAmount] = useState("");
  const [series, setSeries] = useState("");
  const [result, setResult] = useState<OutlookScenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    if (changes.length === 0) {
      setResult(null);
      onScenario(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setComputing(true);
      api
        .post<OutlookScenario>("/outlook/scenario", {
          scope,
          horizon_days: horizonDays,
          adjustments: changes.map((change) => change.adjustment),
        })
        .then((answer) => {
          if (cancelled) return;
          setResult(answer);
          setError(null);
          onScenario(answer.scenario);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
        })
        .finally(() => {
          if (!cancelled) setComputing(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `onScenario` is the page's state setter wrapper; the scenario is recomputed
    // when the changes, the perimeter or the horizon move -- not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the line above
  }, [changes, scope, horizonDays]);

  function reset() {
    setOpen(null);
    setLabel("");
    setAmount("");
    setSeries("");
    setOn(addDays(outlook.as_of, 1));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const target = outlook.series.find((item) => item.id === series);
    if (open === "expense" || open === "income") {
      const cents = parseCents(amount);
      if (cents === null || cents === 0) {
        setError("Montant illisible : écrivez-le en euros, par exemple 1 800 ou 42,50.");
        return;
      }
      const signed = open === "income" ? Math.abs(cents) : -Math.abs(cents);
      const name = label.trim() || (open === "income" ? "Revenu" : "Dépense");
      setChanges([...changes, {
        adjustment: { kind: "one_off", on, label: name, amount_cents: signed },
        title: name,
      }]);
    } else if (target === undefined) {
      setError("Choisissez l'échéance concernée.");
      return;
    } else if (open === "cancel") {
      setChanges([...changes, {
        adjustment: { kind: "cancel", on, series: target.id },
        title: `${target.label} résilié`,
      }]);
    } else if (open === "change") {
      const cents = parseCents(amount);
      if (cents === null) {
        setError("Montant illisible : écrivez-le en euros, par exemple 1 800 ou 42,50.");
        return;
      }
      const signed = target.amount_cents < 0 ? -Math.abs(cents) : Math.abs(cents);
      setChanges([...changes, {
        adjustment: { kind: "change_amount", on, series: target.id, amount_cents: signed },
        title: `${target.label} à ${formatCents(signed, { signed: true })}`,
      }]);
    }
    reset();
  }

  async function keep(change: Change) {
    const adjustment = change.adjustment;
    try {
      await api.post("/planned-events", {
        label: adjustment.label, due_on: adjustment.on, amount_cents: adjustment.amount_cents,
      });
      setChanges(changes.filter((item) => item !== change));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    }
  }

  const base = result?.base.low_point;
  const low = result?.scenario.low_point;
  const baseEnd = result?.base.days[result.base.days.length - 1];
  const scenarioEnd = result?.scenario.days[result.scenario.days.length - 1];

  return (
    <div className="yd-scenario">
      <PanelHead icon={ProjectionIcon}>Et si…</PanelHead>
      <div className="yd-scenario__kinds" role="group" aria-label="Ajouter un changement">
        {KINDS.map((kind) => (
          <button key={kind.value} type="button" aria-pressed={open === kind.value}
            className={open === kind.value ? "is-active" : undefined}
            onClick={() => setOpen(open === kind.value ? null : kind.value)}>
            {kind.label}
          </button>
        ))}
      </div>

      {open !== null ? (
        <form className="yd-upcoming__form" onSubmit={submit}>
          {open === "expense" || open === "income" ? (
            <label className="yd-upcoming__field">
              <span>Libellé</span>
              <input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
            </label>
          ) : (
            <label className="yd-upcoming__field">
              <span>Échéance</span>
              <select value={series} onChange={(event) => setSeries(event.target.value)} required>
                <option value="">Choisir…</option>
                {outlook.series.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} ({formatCents(item.amount_cents, { signed: true })})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="yd-upcoming__field">
            <span>{open === "cancel" || open === "change" ? "À partir du" : "Date"}</span>
            <input type="date" value={on} min={addDays(outlook.as_of, 1)} max={outlook.horizon_end}
              onChange={(event) => setOn(event.target.value)} required />
          </label>
          {open !== "cancel" ? (
            <label className="yd-upcoming__field">
              <span>{open === "change" ? "Nouveau montant (€)" : "Montant (€)"}</span>
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
                required />
            </label>
          ) : null}
          <div className="yd-upcoming__actions">
            <button type="submit" className="yd-upcoming__submit">Ajouter au scénario</button>
          </div>
        </form>
      ) : null}

      {changes.length > 0 ? (
        <ul className="yd-scenario__list">
          {changes.map((change) => (
            <li key={`${change.title}-${change.adjustment.on}`}>
              <span>{change.title} · {dayLabel(change.adjustment.on)}</span>
              {change.adjustment.kind === "one_off" ? (
                <button type="button" className="yd-upcoming__cancel"
                  aria-label={`Enregistrer ${change.title} comme événement prévu`}
                  onClick={() => void keep(change)}>
                  Enregistrer
                </button>
              ) : null}
              <button type="button" className="yd-upcoming__cancel"
                aria-label={`Retirer ${change.title} du scénario`}
                onClick={() => setChanges(changes.filter((item) => item !== change))}>
                Retirer
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="yd-avenir__sub">
          Ajoutez une dépense, un revenu, une résiliation ou un nouveau montant : la courbe du
          scénario s'affiche en pointillé à côté de la vôtre. Rien n'est enregistré.
        </p>
      )}

      {computing ? <p className="yd-avenir__sub" role="status">Calcul du scénario…</p> : null}
      {error !== null ? <p role="alert" className="yd-avenir__error">{error}</p> : null}

      {result !== null && low && base ? (
        <p className="yd-scenario__result">
          Avec ce scénario : point bas {formatCents(low.p50_cents, { signed: true })} le{" "}
          {dayLabel(low.on)}, au lieu de {formatCents(base.p50_cents, { signed: true })} le{" "}
          {dayLabel(base.on)}.
          {baseEnd && scenarioEnd
            ? ` Au ${dayLabel(scenarioEnd.on)} : ${formatCents(scenarioEnd.p50_cents, { signed: true })} au lieu de ${formatCents(baseEnd.p50_cents, { signed: true })}.`
            : null}
        </p>
      ) : null}
    </div>
  );
}
