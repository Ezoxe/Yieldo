import { SessionLoading } from "../features/auth/SessionLoading";
import { useSession } from "../features/auth/session";
import { LandingPage } from "../features/landing/LandingPage";
import { AppShell } from "./AppShell";

/** The authenticated shell, reading the signed-in name off the session. */
export function AppShellRoute() {
  const userName = useSession((state) => state.user?.name ?? "");
  return <AppShell userName={userName} />;
}

/**
 * `/` is the app's only route with two faces: the public landing page for a
 * visitor, and the dashboard inside the shell for the operator.
 *
 * The unresolved case is the one that matters. `hydrate()` is fired from
 * main.tsx before the router mounts but resolves asynchronously, so for the
 * first instants of every reload the session is neither authenticated nor
 * anonymous — and rendering *either* face then is a visible bug: an operator
 * refreshing their dashboard would see the marketing page flash first.
 * `RequireAuth` has carried the same guard for the same reason since phase 1,
 * and this gate shows the same quiet state it does.
 *
 * Lives outside app/routes.tsx so a test can mount it without evaluating
 * `createBrowserRouter` and the whole screen graph behind it.
 */
export function HomeRoute() {
  const status = useSession((state) => state.status);

  if (status === "idle" || status === "loading") {
    return <SessionLoading />;
  }

  if (status === "anonymous") {
    return <LandingPage />;
  }

  // AppShell's <Outlet /> is what renders the dashboard beneath it — see the
  // index child of the "/" route in app/routes.tsx.
  return <AppShellRoute />;
}
