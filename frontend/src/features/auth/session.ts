import { create } from "zustand";

import { api, onUnauthorized, setAccessToken } from "../../lib/api";
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

export const useSession = create<SessionState>((set) => {
  function applySession(token: TokenResponse) {
    setAccessToken(token.access_token);
    set({
      user: token.user,
      accessToken: token.access_token,
      status: "authenticated",
      isAuthenticated: true,
    });
  }

  function clearSession() {
    setAccessToken(null);
    set({ user: null, accessToken: null, status: "anonymous", isAuthenticated: false });
  }

  return {
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
      set({ status: "loading" });
      try {
        const token = await api.post<TokenResponse>("/auth/refresh");
        applySession(token);
      } catch {
        clearSession();
      }
    },
  };
});

// A refresh retry that still comes back 401 means the session is unrecoverable —
// reset the store so RequireAuth sends the user back to the login screen instead
// of leaving stale state around.
onUnauthorized(() => {
  setAccessToken(null);
  useSession.setState({
    user: null,
    accessToken: null,
    status: "anonymous",
    isAuthenticated: false,
  });
});
