import { create } from "zustand";

import { readStoredMotionDisabled, storeMotionDisabled } from "../theme";

interface MotionPreferenceState {
  // The Reglages "Animations" switch — an explicit user override, independent
  // of (and additive to) the OS-level prefers-reduced-motion query that
  // useReducedMotion() also consults.
  disabled: boolean;
  setDisabled: (disabled: boolean) => void;
}

/**
 * Mirrors the switch onto the document root, the way ThemeProvider writes
 * `data-theme` and DensityProvider writes `data-density`.
 *
 * Without it the preference lives only in this store, where no stylesheet can
 * see it: every CSS transition and keyframe in the app would honour the OS
 * `prefers-reduced-motion` query and silently ignore the user's own switch.
 * `useReducedMotion()` remains the JS gate; this is its CSS twin.
 *
 * The value is written in both directions ("on" as well as "off") rather than
 * being added and removed, so a stylesheet could key off either state.
 */
export function applyMotionAttribute(disabled: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.motion = disabled ? "off" : "on";
}

export const useMotionPreference = create<MotionPreferenceState>((set) => ({
  disabled: readStoredMotionDisabled(),
  setDisabled: (disabled) => {
    storeMotionDisabled(disabled);
    applyMotionAttribute(disabled);
    set({ disabled });
  },
}));
