import { create } from "zustand";

import { readStoredMotionDisabled, storeMotionDisabled } from "../theme";

interface MotionPreferenceState {
  // The Reglages "Animations" switch — an explicit user override, independent
  // of (and additive to) the OS-level prefers-reduced-motion query that
  // useReducedMotion() also consults.
  disabled: boolean;
  setDisabled: (disabled: boolean) => void;
}

export const useMotionPreference = create<MotionPreferenceState>((set) => ({
  disabled: readStoredMotionDisabled(),
  setDisabled: (disabled) => {
    storeMotionDisabled(disabled);
    set({ disabled });
  },
}));
