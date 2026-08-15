import "./AuthPage.css";

/**
 * The quiet state shown while `hydrate()` (fired from main.tsx) is still
 * trading the refresh cookie for an access token.
 *
 * Both places that have to decide what an unresolved session renders — the
 * `RequireAuth` guard and the `/` gate in app/routes.tsx — show this exact
 * markup. Deciding early is the bug it exists to prevent: a redirect or a
 * landing page rendered before the session resolves bounces an authenticated
 * operator on every reload.
 */
export function SessionLoading() {
  return (
    <div className="yd-auth-loading" role="status" aria-live="polite">
      Chargement…
    </div>
  );
}
