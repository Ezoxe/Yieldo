import { useState } from "react";

import { ChevronIcon } from "../../design/icons";
import { InfoTip } from "../../design/InfoTip";
import { useMediaQuery } from "../../lib/useMediaQuery";
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
 *
 * Below 900px it is the same choice in a different control. A phone header
 * holds the menu, the reading and the assistant on one 375px line, and three
 * labelled segments do not fit beside the other two -- they used to render
 * UNDER the fixed menu button. A native `<select>` is the list button that
 * does fit: one control naming the current reading, opening the three, with
 * the platform's own wheel and screen-reader announcement rather than a
 * hand-rolled popover. Rendering both markups and hiding one with a media
 * query would put two controls with the same accessible name in the document,
 * which is worse than either.
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

  const compact = useMediaQuery("(max-width: 899px)");

  return (
    <div className="yd-mode">
      {compact ? (
        <span className={`yd-mode__list${mode === "real" ? "" : " yd-mode__list--qualified"}`}>
          <select
            className="yd-mode__select"
            aria-label="Mode de lecture"
            value={mode}
            disabled={!loaded || saving}
            onChange={(event) => void choose(event.target.value as LedgerMode)}
          >
            {LEDGER_MODES.map((option) => (
              <option key={option} value={option}>
                {LEDGER_MODE_LABELS[option]}
              </option>
            ))}
          </select>
          {/* The platform chevron is dropped with `appearance: none`, so the
              disclosure is drawn back with the app's own glyph. Decoration:
              the select carries the whole accessible name. */}
          <ChevronIcon aria-hidden="true" />
        </span>
      ) : (
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
      )}
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
