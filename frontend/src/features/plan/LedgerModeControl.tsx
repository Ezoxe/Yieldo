import { useState } from "react";

import { InfoTip } from "../../design/InfoTip";
import type { LedgerMode } from "../../lib/types";
import { LEDGER_MODE_LABELS, LEDGER_MODE_NOTES, LEDGER_MODES, useLedgerMode } from "./useLedgerMode";
import "./LedgerModeControl.css";

/**
 * The reading every figure in the application is in, stated where it cannot be
 * missed and changed in one click.
 *
 * It sits in the header beside the assistant because it is the other control
 * that DOES something rather than sets a preference — and because a figure
 * mixing a statement with a declaration and not saying so is a lie told in the
 * right font. The control IS the statement: when it is not on "Réel" it takes
 * the info tint, which is exactly what that token is for (a standing condition
 * qualifying everything below it).
 *
 * A failed write leaves the control where the server still is. Showing the
 * mode a household asked for while the figures are still in the old one would
 * be the same lie in the other direction.
 */
export function LedgerModeControl() {
  const mode = useLedgerMode((state) => state.mode);
  const loaded = useLedgerMode((state) => state.loaded);
  const setMode = useLedgerMode((state) => state.setMode);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function choose(next: LedgerMode) {
    if (next === mode || saving) return;
    setError(null);
    setSaving(true);
    try {
      await setMode(next);
    } catch {
      setError("Le mode de lecture n'a pas pu être changé. Les chiffres restent en " +
        `« ${LEDGER_MODE_LABELS[mode]} ».`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="yd-mode">
      <div
        className={`yd-mode__group${mode === "real" ? "" : " yd-mode__group--qualified"}`}
        role="radiogroup"
        aria-label="Mode de lecture"
      >
        {LEDGER_MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            className="yd-mode__option"
            disabled={!loaded || saving}
            title={LEDGER_MODE_NOTES[option]}
            onClick={() => void choose(option)}
          >
            {LEDGER_MODE_LABELS[option]}
          </button>
        ))}
      </div>
      <InfoTip label="Ce que le mode de lecture change">
        {LEDGER_MODE_NOTES.real} {LEDGER_MODE_NOTES.estimated} {LEDGER_MODE_NOTES.blended} Les
        récurrences détectées, les anomalies et le solde de vos comptes restent toujours réels.
      </InfoTip>
      {error !== null ? (
        <p className="yd-mode__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
