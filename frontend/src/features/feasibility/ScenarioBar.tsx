import { useId, useState, type FormEvent } from "react";

import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { FeasibilityRequest, Scenario } from "../../lib/types";
import { VERDICT_LABEL } from "./VerdictPanel";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** The `save_more` lever's extra, or null when there is no lever list at all —
 *  which is the case whenever the capacity could not be measured. Deliberately
 *  labelled as an EXTRA and never as "the required monthly saving": it is what
 *  has to change, on top of what is already measured. */
function extraPerMonth(scenario: Scenario): number | null {
  const lever = scenario.result.levers.find((entry) => entry.kind === "save_more");
  return lever?.extra_monthly_cents ?? null;
}

interface ScenarioBarProps {
  scenarios: Scenario[];
  /** The question currently on screen. null before anything has been asked —
   *  there is then nothing to name and save. */
  current: FeasibilityRequest | null;
  /** Reload the list from the server, so every row is recomputed together. */
  onChanged: () => void;
  /** Put a saved question back into the form. */
  onReopen: (request: FeasibilityRequest) => void;
}

/**
 * Save a question, list the saved ones, and compare their answers.
 *
 * A scenario stores the QUESTION and never the answer: every row here is
 * recomputed against the current statements on every read, which is the only
 * reason two of them can be put side by side at all. The screen says so rather
 * than letting a saved row read as a saved verdict.
 */
export function ScenarioBar({ scenarios, current, onChanged, onReopen }: ScenarioBarProps) {
  const baseId = useId();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  // Two registers, as everywhere on this screen: a 422 is the server declining
  // for a stated reason, anything else is a failure.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function report(err: unknown) {
    if (err instanceof ApiError && err.status === 422) {
      setRefusal(err.detail);
      setError(null);
    } else {
      setRefusal(null);
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (current === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setRefusal(null);
      setError("Donnez un nom à ce scénario, par exemple « Voiture 40 000 € en 12 mois ».");
      return;
    }
    setSaving(true);
    setRefusal(null);
    setError(null);
    try {
      await api.post("/feasibility/scenarios", { name: trimmed, request: current });
      setName("");
      onChanged();
    } catch (err) {
      report(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await api.delete(`/feasibility/scenarios/${id}`);
      setPendingDelete(null);
      setRefusal(null);
      setError(null);
      onChanged();
    } catch (err) {
      report(err);
    }
  }

  return (
    <div className="yd-scenarios">
      <form className="yd-scenarios__save" onSubmit={save} noValidate>
        <div className="yd-scenarios__field">
          <label htmlFor={`${baseId}-name`}>Nom de ce scénario</label>
          <input
            id={`${baseId}-name`}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Voiture 40 000 € en 12 mois"
            disabled={current === null}
          />
        </div>
        <button type="submit" className="yd-scenarios__submit" disabled={current === null || saving}>
          {saving ? "Enregistrement…" : "Enregistrer la question"}
        </button>
      </form>

      {current === null ? (
        <p className="yd-scenarios__note">
          Posez d'abord une question ci-dessus : c'est elle qui est enregistrée.
        </p>
      ) : null}

      {refusal !== null ? <p className="yd-feas__refusal">{refusal}</p> : null}
      {error !== null ? (
        <p role="alert" className="yd-feas__alert">
          {error}
        </p>
      ) : null}

      {scenarios.length === 0 ? (
        <p className="yd-scenarios__note">
          Aucun scénario enregistré. Deux questions enregistrées se comparent ligne à ligne.
        </p>
      ) : (
        <>
          {/* Said before the table, not after: a row of figures under a saved
              name reads as a saved answer unless the screen corrects it. */}
          <p className="yd-scenarios__note">
            Chaque scénario garde la question, jamais la réponse : les chiffres ci-dessous sont
            recalculés sur vos relevés actuels à chaque affichage. C'est ce qui rend deux scénarios
            comparables — ils sont toujours répondus à partir des mêmes données.
          </p>

          <div className="yd-scenarios__table" data-testid="yd-scenarios-table">
            <div className="yd-scenarios__row yd-scenarios__row--head">
              <span>Scénario</span>
              <span>Verdict</span>
              <span>Écart</span>
              <span>À épargner en plus</span>
              <span />
            </div>
            {scenarios.map((scenario) => {
              const result = scenario.result;
              const extra = extraPerMonth(scenario);
              return (
                <div
                  className="yd-scenarios__row"
                  key={scenario.id}
                  data-testid={`yd-scenario-${scenario.id}`}
                >
                  <span className="yd-scenarios__name">
                    <button
                      type="button"
                      className="yd-scenarios__reopen"
                      onClick={() => onReopen(scenario.request)}
                    >
                      {scenario.name}
                    </button>
                    <span className="yd-scenarios__question">
                      {`${formatCents(result.target_cents)} en ${result.horizon_months} mois`}
                    </span>
                  </span>

                  <span
                    className={`yd-scenarios__verdict${
                      result.verdict !== null ? ` yd-scenarios__verdict--${result.verdict}` : ""
                    }`}
                  >
                    {/* Below 900px the header row is hidden and the cells stack,
                        so each figure carries its own label. Without it a bare
                        "+4 033,94 €" under a gap is a number with no noun. */}
                    <span className="yd-scenarios__cell-label">Verdict : </span>
                    {/* null exactly when the capacity could not be measured.
                        A dash would read as "no gap"; the words say which. */}
                    {result.verdict === null ? "Non rendu" : VERDICT_LABEL[result.verdict]}
                  </span>

                  <span className="yd-scenarios__figure">
                    <span className="yd-scenarios__cell-label">Écart : </span>
                    {result.gap_cents === null
                      ? "—"
                      : result.gap_cents > 0
                        ? `${formatCents(result.gap_cents)} manquants`
                        : `${formatCents(Math.abs(result.gap_cents))} de marge`}
                  </span>

                  <span className="yd-scenarios__figure">
                    <span className="yd-scenarios__cell-label">À épargner en plus : </span>
                    {extra === null ? "—" : formatCents(extra, { signed: true })}
                  </span>

                  <span className="yd-scenarios__actions">
                    {pendingDelete === scenario.id ? (
                      <>
                        <span className="yd-scenarios__confirm">
                          {`Supprimer « ${scenario.name} » ?`}
                        </span>
                        <button
                          type="button"
                          className="yd-scenarios__action yd-scenarios__action--danger"
                          onClick={() => void remove(scenario.id)}
                        >
                          Confirmer
                        </button>
                        <button
                          type="button"
                          className="yd-scenarios__action"
                          onClick={() => setPendingDelete(null)}
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      // Confirmed first, always. Phase 2A shipped a destructive
                      // control that fired on one unconfirmed click, and that
                      // defect was promoted into this plan rather than deferred.
                      <button
                        type="button"
                        className="yd-scenarios__action"
                        onClick={() => setPendingDelete(scenario.id)}
                      >
                        <span className="sr-only">{`Supprimer ${scenario.name}`}</span>
                        <span aria-hidden="true">Supprimer</span>
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
