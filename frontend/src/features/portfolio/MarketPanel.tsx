import { plural } from "../../lib/plural";
import type { Connection } from "../../lib/types";
import { PROVIDER_LABEL, PROVIDER_ROLE } from "../connections/providers";

function quotaSentence(connection: Connection): string {
  const { quota } = connection;
  if (quota.limit === null) {
    // Frankfurter. `null` means genuinely unlimited, never a large integer
    // standing in for one.
    return `${quota.used} ${plural(quota.used, "appel effectué", "appels effectués")} — accès illimité, aucune clé requise.`;
  }
  const remaining = quota.remaining ?? 0;
  return `${quota.used} ${plural(quota.used, "appel effectué", "appels effectués")} sur ${
    quota.limit
  } — ${remaining} ${plural(remaining, "restant", "restants")} avant le plafond de prudence${
    quota.ceiling === null ? "" : ` (${quota.ceiling})`
  }.`;
}

/**
 * Which market-data providers are reachable, and — the point of this panel —
 * **whether a key is registered at all.**
 *
 * "Aucune clé n'est enregistrée" is one of `market/client.py`'s five causes,
 * and it is the operator's actual state today. It is a fact about the
 * INSTALLATION, not about any one position, so it is said here, once, plainly
 * — rather than being inferred from a price that happens to be missing. A
 * household with no positions has no missing price to infer it from at all,
 * which is exactly why this panel exists.
 *
 * The panel never suggests the application is broken without a key. It is not:
 * everything except live valuation works, and the sentence says so.
 */
export function MarketPanel({ connections }: { connections: Connection[] }) {
  const needKey = connections.filter((c) => c.requires_key);
  const configured = needKey.filter((c) => c.configured);
  const noneConfigured = configured.length === 0;

  return (
    <div className="yd-market" data-testid="yd-market-panel">
      {noneConfigured ? (
        <p className="yd-patrimoine__refusal" data-testid="yd-market-no-key">
          Aucune clé n'est enregistrée pour l'instant. Aucun prix ne peut donc être relevé, et vos
          positions restent affichées à leur prix de revient sans valeur de marché. Rien d'autre
          n'est affecté : la saisie des comptes, des positions et des lots fonctionne sans aucune
          clé, et l'allocation cible se déclare de la même façon.
        </p>
      ) : (
        <p className="yd-patrimoine__note" data-testid="yd-market-some-keys">
          {`${configured.length} ${plural(
            configured.length,
            "fournisseur est configuré",
            "fournisseurs sont configurés",
          )} sur les ${needKey.length} qui demandent une clé.`}
        </p>
      )}

      <ul className="yd-providers">
        {connections.map((connection) => {
          const label = PROVIDER_LABEL[connection.provider] ?? connection.provider;
          // Three states, not two: a provider needing a key and having one, a
          // provider needing one and lacking it, and a provider needing none
          // at all. Collapsing the third into "configuré" would claim a key
          // was entered for Frankfurter, which never happens.
          const state = !connection.requires_key
            ? { className: "open", text: "Aucune clé requise" }
            : connection.configured
              ? { className: "set", text: "Clé enregistrée" }
              : { className: "unset", text: "Aucune clé" };

          return (
            <li
              key={connection.provider}
              className={`yd-provider yd-provider--${state.className}`}
              data-testid={`yd-provider-${connection.provider}`}
            >
              <div className="yd-provider__head">
                <h3 className="yd-provider__name">{label}</h3>
                <span className={`yd-provider__state yd-provider__state--${state.className}`}>
                  {state.text}
                </span>
              </div>
              <p className="yd-provider__role">
                {PROVIDER_ROLE[connection.provider] ?? "Données de marché"}
              </p>
              <p className="yd-provider__quota">{quotaSentence(connection)}</p>
            </li>
          );
        })}
      </ul>

      <a className="yd-patrimoine__link" href="/reglages/connexions">
        Enregistrer une clé dans Réglages → Connexions
      </a>
    </div>
  );
}
