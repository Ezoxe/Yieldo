import { create } from "zustand";

import { api } from "../../lib/api";
import type { Proposal } from "../../lib/types";

interface ProposalCountState {
  pending: number;
  refresh: () => Promise<void>;
}

/**
 * How many proposals are waiting, for the badge in the sidebar.
 *
 * A count rather than the list: the sidebar needs a number, and fetching every
 * payload on every page load to render one would be paying for the screen
 * nobody has opened yet.
 *
 * A failed fetch leaves the badge at whatever it last knew, and never at a
 * confident zero — "nothing is waiting" is a claim, and the one thing this
 * store must not do is quietly tell a household there is nothing to review.
 */
export const useProposalCount = create<ProposalCountState>((set) => ({
  pending: 0,
  refresh: async () => {
    try {
      const rows = await api.get<Proposal[]>("/agent/proposals", { state: "pending" });
      set({ pending: rows.length });
    } catch {
      // Deliberately no `set`: see the store's docstring.
    }
  },
}));
