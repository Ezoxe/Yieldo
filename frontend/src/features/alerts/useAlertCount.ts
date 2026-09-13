import { create } from "zustand";

import { api } from "../../lib/api";

interface AlertCountState {
  count: number;
  refresh: () => Promise<void>;
}

/**
 * How many alerts are in force, for the badge beside « Alertes » in the
 * sidebar. Same shape as `useProposalCount` for the same reasons: a number
 * rather than the report (the sidebar renders on every screen), refreshed on
 * navigation rather than polled, and a failed fetch leaves the badge at what
 * it last knew rather than at a confident zero — « rien en cours » is a claim
 * this store must not make by accident.
 *
 * Before this store an alert existed only on the screen that listed it: a
 * budget crossed in March was news in April, when the household happened to
 * open Alertes.
 */
export const useAlertCount = create<AlertCountState>((set) => ({
  count: 0,
  refresh: async () => {
    try {
      const body = await api.get<{ count: number }>("/alerts/count");
      set({ count: body.count });
    } catch {
      // Deliberately no `set`: see the store's docstring.
    }
  },
}));
