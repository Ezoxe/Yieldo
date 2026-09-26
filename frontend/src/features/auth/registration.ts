import { useEffect, useState } from "react";

import { api } from "../../lib/api";
import type { RegistrationStatus } from "../../lib/types";

export type RegistrationState = "loading" | "open" | "closed" | "unknown";

/**
 * Whether this installation takes new accounts.
 *
 * "unknown" when the question could not be asked: the screens then offer the
 * form anyway, because the server is the one that decides and says so in
 * French if it refuses. A failed read never stands in for "closed".
 */
export function useRegistrationStatus(): RegistrationState {
  const [state, setState] = useState<RegistrationState>("loading");
  useEffect(() => {
    let cancelled = false;
    api
      .get<RegistrationStatus>("/auth/registration")
      .then((status) => {
        if (!cancelled) setState(status.open ? "open" : "closed");
      })
      .catch(() => {
        if (!cancelled) setState("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
