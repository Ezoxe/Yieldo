import { create } from "zustand";

import { readStoredShibiHidden, storeShibiHidden } from "../theme";

interface ShibiPreferenceState {
  /** The Réglages "Afficher le shibi" switch, held the wrong way round on
   *  purpose: absent means shown, so a household that never opens Réglages
   *  meets the mascot. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

/**
 * Whether the shibi is on screen at all.
 *
 * Browser-held, not server-held: this is a preference about what one person
 * sees on one machine, like the theme and the density beside it — not a
 * statement about the account's data, which is what `useLedgerMode` is for.
 *
 * Call sites ask through `useShibiVisible()` rather than reading `hidden`
 * directly, so the sense of the switch is stated once.
 */
export const useShibiPreference = create<ShibiPreferenceState>((set) => ({
  hidden: readStoredShibiHidden(),
  setHidden: (hidden) => {
    storeShibiHidden(hidden);
    set({ hidden });
  },
}));

/**
 * Whether to draw him here.
 *
 * Every call site keeps its own fallback rather than the component returning
 * null on its own: the header button still needs a mark when the shibi is off,
 * and a component that silently disappeared would leave a button with nothing
 * in it.
 */
export function useShibiVisible(): boolean {
  return !useShibiPreference((state) => state.hidden);
}
