import { create } from "zustand";

import { api } from "../../lib/api";
import type { LedgerMode } from "../../lib/types";

/** The three readings, in the order the control shows them: what happened,
 *  what was declared, and the one that answers the month in progress. */
export const LEDGER_MODES: LedgerMode[] = ["real", "estimated", "blended"];

export const LEDGER_MODE_LABELS: Record<LedgerMode, string> = {
  real: "Réel",
  estimated: "Estimé",
  blended: "Réel complété",
};

/** What each reading actually does, in one sentence, for the control's tooltip
 *  and for the plan screen. A reader must never have to guess which of three
 *  things a figure is. */
export const LEDGER_MODE_NOTES: Record<LedgerMode, string> = {
  real: "Vos relevés, et rien d'autre.",
  estimated: "Votre plan prévisionnel seul, comme si aucun relevé n'existait.",
  blended:
    "Vos relevés, complétés par les lignes du plan qui ne sont pas encore passées. " +
    "Une dépense déjà présente sur le relevé n'est jamais comptée deux fois.",
};

interface LedgerModeState {
  mode: LedgerMode;
  /** False until the server has answered once. The header control stays
   *  disabled until then rather than showing "Réel" as though it were a
   *  choice the household had made. */
  loaded: boolean;
  hydrate: () => Promise<void>;
  setMode: (next: LedgerMode) => Promise<void>;
}

/**
 * Which reading the whole application is answering in.
 *
 * Server-held, not browser-held — see `backend/app/models/plan_settings.py`
 * for why: the export and the assistant both have to know the mode, and a
 * mode kept in a tab is a mode neither can see. This store is a cache of that
 * one value, hydrated once by the shell and written through on every change.
 *
 * A failed write leaves the store on the value the server still holds, so the
 * control never shows a mode the figures are not actually in.
 */
export const useLedgerMode = create<LedgerModeState>((set) => ({
  mode: "real",
  loaded: false,
  hydrate: async () => {
    try {
      const body = await api.get<{ mode: LedgerMode }>("/plan/mode");
      set({ mode: body.mode, loaded: true });
    } catch {
      // The ledger reads as it always has. Not a silent fallback standing in
      // for data: `real` IS the application without this feature, and a
      // household that cannot reach the setting is not in another mode.
      set({ loaded: true });
    }
  },
  setMode: async (next) => {
    const body = await api.put<{ mode: LedgerMode }>("/plan/mode", { mode: next });
    set({ mode: body.mode });
  },
}));
