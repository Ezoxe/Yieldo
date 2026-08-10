import { create } from "zustand";

import { api, onTokenRefreshed, onUnauthorized, setAccessToken } from "../../lib/api";
import type { User } from "../../lib/types";

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export type SessionStatus = "idle" | "loading" | "authenticated" | "anonymous";

interface SessionState {
  user: User | null;
  accessToken: string | null;
  status: SessionStatus;
  // Derived from `status`, kept as its own field because the brief's public
  // contract for useSession() names it directly alongside `status`.
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

// Hoisted out of the store creator (rather than closed over inside it) so
// api.ts's own silent refresh — fired internally on a 401 from some unrelated
// request, see onTokenRefreshed below — can update the store through this
// exact same function, not a second, easily-drifting copy of the same logic.
function applySession(session: { access_token: string; user: User }): void {
  setAccessToken(session.access_token);
  useSession.setState({
    user: session.user,
    accessToken: session.access_token,
    status: "authenticated",
    isAuthenticated: true,
  });
}

function clearSession(): void {
  setAccessToken(null);
  useSession.setState({ user: null, accessToken: null, status: "anonymous", isAuthenticated: false });
}

export const useSession = create<SessionState>(() => ({
  user: null,
  accessToken: null,
  status: "idle",
  isAuthenticated: false,

  async login(input) {
    const token = await api.post<TokenResponse>("/auth/login", input);
    applySession(token);
  },

  async register(input) {
    const token = await api.post<TokenResponse>("/auth/register", input);
    applySession(token);
  },

  async logout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // The refresh cookie may already be gone server-side (expired, revoked) —
      // the client must still drop its own session state either way.
    } finally {
      clearSession();
    }
  },

  async hydrate() {
    // The access token lives in memory only, so it never survives a reload.
    // The HttpOnly refresh cookie does, so this trades it for a fresh token —
    // the only way an authenticated user stays signed in across a refresh.
    useSession.setState({ status: "loading" });
    try {
      const token = await api.post<TokenResponse>("/auth/refresh");
      applySession(token);
    } catch {
      clearSession();
    }
  },
}));

// api.ts's own retry-on-401 refreshes the token internally, outside of any
// store action — this is what keeps useSession.getState().accessToken from
// going stale the moment that happens.
onTokenRefreshed(applySession);

// A refresh retry that still comes back 401 means the session is unrecoverable —
// reset the store so RequireAuth sends the user back to the login screen instead
// of leaving stale state around.
onUnauthorized(clearSession);
