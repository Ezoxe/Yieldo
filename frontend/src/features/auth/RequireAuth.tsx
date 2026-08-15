import { Navigate, Outlet } from "react-router";

import "./AuthPage.css";
import { SessionLoading } from "./SessionLoading";
import { useSession } from "./session";

export function RequireAuth() {
  const status = useSession((state) => state.status);

  // "idle" is the brief instant before hydrate() (called from main.tsx) resolves
  // the refresh cookie into a session. Treating it the same as "loading" — i.e.
  // never redirecting here — is what keeps a page reload from bouncing an
  // already-authenticated user back to the login screen.
  if (status === "idle" || status === "loading") {
    return <SessionLoading />;
  }

  if (status === "anonymous") {
    return <Navigate to="/connexion" replace />;
  }

  return <Outlet />;
}
