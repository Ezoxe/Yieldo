import { Link } from "react-router";

import { LEDGER_MODE_LABELS, LEDGER_MODE_NOTES, useLedgerMode } from "./useLedgerMode";
import "./LedgerModeBadge.css";

/**
 * A standing condition, named where the figures are — and nowhere else.
 *
 * The three-way control it replaces in the header now lives in Réglages, where
 * a choice made a few times a year belongs. What cannot move is the STATEMENT:
 * a figure mixing a relevé with a declaration and not saying so is a lie told
 * in the right font.
 *
 * So this renders nothing at all in « Réel ». A permanent badge reading "Réel"
 * would be a label eleven months out of twelve for a fact that is the default —
 * noise, and noise is what makes a real warning invisible. When the reading IS
 * qualified the badge appears, takes the info tint (that token is exactly for a
 * standing condition qualifying everything below it), and leads to the control
 * that set it.
 */
export function LedgerModeBadge() {
  const mode = useLedgerMode((state) => state.mode);
  const loaded = useLedgerMode((state) => state.loaded);

  if (!loaded || mode === "real") return null;

  return (
    <Link className="yd-mode-badge" to="/reglages" title={LEDGER_MODE_NOTES[mode]}>
      <span className="yd-mode-badge__dot" aria-hidden="true" />
      Mode {LEDGER_MODE_LABELS[mode]}
    </Link>
  );
}
