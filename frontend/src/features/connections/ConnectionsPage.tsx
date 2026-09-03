import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { api } from "../../lib/api";
import { plural } from "../../lib/plural";
import { messageFor } from "../../lib/refusal";
import type {
  Connection,
  ConnectionValidation,
  LlmSettings,
  MarketProvider,
} from "../../lib/types";
import {
  PROVIDER_LABEL,
  PROVIDER_NO_KEY_NEEDED,
  PROVIDER_ROLE,
  PROVIDER_SIGNUP,
} from "./providers";
import "./ConnectionsPage.css";

const SPAN = {
  market: { base: 1, md: 6, lg: 7 },
  model: { base: 1, md: 6, lg: 5 },
  full: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

/** The sentence this whole screen is built around, and the reason a key field
 *  is never prefilled: there is nothing to prefill it WITH. `ConnectionOut`
 *  and `LlmSettingsOut` have no field that could carry a key, encrypted or
 *  not — the shapes have nowhere to put one. Showing "••••••••" would suggest
 *  a value that could be revealed, and none can. */
const WRITE_ONLY =
  "Yieldo ne vous rendra jamais cette clé. Elle est chiffrée à l'enregistrement et ne ressort jamais du serveur : cet écran peut dire qu'une clé existe, jamais laquelle. Pour la changer, saisissez-en une nouvelle ; pour l'effacer, supprimez-la.";

const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});

function formatMoment(iso: string | null): string | null {
  if (iso === null) return null;
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? null : DATE_TIME.format(value);
}

/** What the quota pool says, in the provider's own units.
 *
 *  `limit === null` is genuinely unlimited (Frankfurter) and never a large
 *  integer standing in for one, so it gets its own sentence rather than
 *  "0 appels sur null". */
function quotaSentence(connection: Connection): string {
  const { quota } = connection;
  const used = `${quota.used} ${plural(quota.used, "appel effectué", "appels effectués")}`;
  if (quota.limit === null) {
    return `${used} — accès illimité, aucun plafond à surveiller.`;
  }
  const remaining = quota.remaining ?? 0;
  const reset = formatMoment(quota.reset_at);
  const ceiling = quota.ceiling === null ? "" : ` (${quota.ceiling})`;
  return (
    `${used} sur ${quota.limit} — ${remaining} ${plural(remaining, "restant", "restants")} ` +
    `avant le plafond de prudence${ceiling}` +
    (reset === null ? "." : `, réinitialisé le ${reset}.`)
  );
}

/** Three states, never two. A provider that needs no key is not "not yet
 *  configured": there is nothing for the household to do, and collapsing the
 *  two would invent a chore. */
function providerState(connection: Connection): { className: string; text: string } {
  if (!connection.requires_key) return { className: "open", text: "Aucune clé requise" };
  if (connection.configured) return { className: "set", text: "Clé enregistrée" };
  return { className: "unset", text: "Aucune clé" };
}

interface Outcome {
  ok: boolean;
  message: string;
}

interface ProviderCardProps {
  connection: Connection;
  outcome: Outcome | null;
  busy: boolean;
  onSave: (provider: MarketProvider, key: string) => void;
  onDelete: (provider: MarketProvider) => void;
}

/**
 * One market provider: what it is for, whether a key is registered, what the
 * quota pool has left, and — only when the provider actually needs one — the
 * write-only field to enter a key.
 *
 * The field is always EMPTY, whether or not a key is stored. A stored key
 * changes the label ("Remplacer la clé") and adds a Supprimer button; it never
 * fills the box with a masked value, because a masked value reads as something
 * retrievable and nothing here is.
 */
function ProviderCard({ connection, outcome, busy, onSave, onDelete }: ProviderCardProps) {
  const [value, setValue] = useState("");
  const state = providerState(connection);
  const label = PROVIDER_LABEL[connection.provider] ?? connection.provider;
  const lastUsed = formatMoment(connection.last_used_at);
  const fieldId = `yd-key-${connection.provider}`;
  const hintId = `${fieldId}-hint`;

  return (
    <li
      className={`yd-conn yd-conn--${state.className}`}
      data-testid={`yd-conn-${connection.provider}`}
    >
      <div className="yd-conn__head">
        <h3 className="yd-conn__name">{label}</h3>
        <span className={`yd-conn__state yd-conn__state--${state.className}`}>{state.text}</span>
      </div>
      <p className="yd-conn__role">{PROVIDER_ROLE[connection.provider] ?? "Données de marché"}</p>
      <p className="yd-conn__quota">{quotaSentence(connection)}</p>
      <p className="yd-conn__used">
        {lastUsed === null
          ? "Jamais utilisée depuis cet écran."
          : `Dernière utilisation : ${lastUsed}.`}
      </p>

      {connection.requires_key ? (
        <form
          className="yd-conn__form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(connection.provider, value);
            setValue("");
          }}
        >
          <label className="yd-conn__field" htmlFor={fieldId}>
            <span>{connection.configured ? "Remplacer la clé" : "Clé d'API"}</span>
            <input
              id={fieldId}
              type="password"
              value={value}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={hintId}
              placeholder=""
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <p className="yd-conn__hint" id={hintId}>
            {WRITE_ONLY}
          </p>
          {PROVIDER_SIGNUP[connection.provider] !== undefined ? (
            <p className="yd-conn__hint">{PROVIDER_SIGNUP[connection.provider]}</p>
          ) : null}
          <div className="yd-conn__actions">
            <button
              type="submit"
              className="yd-conn__action yd-conn__action--primary"
              disabled={busy || value.trim() === ""}
            >
              {busy ? "Validation en cours…" : "Valider et enregistrer"}
            </button>
            {connection.configured ? (
              <button
                type="button"
                className="yd-conn__action"
                disabled={busy}
                onClick={() => onDelete(connection.provider)}
              >
                Supprimer la clé
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="yd-conn__nokey" data-testid={`yd-conn-nokey-${connection.provider}`}>
          {PROVIDER_NO_KEY_NEEDED[connection.provider] ??
            "Aucune clé n'est nécessaire pour ce fournisseur."}
        </p>
      )}

      {/* The outcome of the real call, printed where the key was typed. Never
          a `role="alert"`: a rejected key is a 200 the provider actually
          answered, and this screen reserves alert for a round trip that
          failed. `aria-live` still announces it. */}
      <p
        className={`yd-conn__outcome yd-conn__outcome--${
          outcome === null ? "idle" : outcome.ok ? "ok" : "bad"
        }`}
        aria-live="polite"
        data-testid={`yd-conn-outcome-${connection.provider}`}
      >
        {outcome === null ? "" : outcome.message}
      </p>
    </li>
  );
}

/**
 * `/reglages/connexions` — Réglages → Connexions. Design §9 and §8.3.
 *
 * **The screen the operator has been missing.** `/api/connections` shipped in
 * phase 3 and `/api/assistant/llm` in phase 4, both without one: entering a
 * market key or pointing at a model meant reaching for curl, which put the
 * whole market and assistant surface out of reach.
 *
 * **A key is write-only, and the screen says so rather than implying it.**
 * Every field here is empty on arrival and empty after a save. No masked
 * value is ever shown, because a masked value looks like something that could
 * be revealed and nothing on this server can be: the read shapes have no field
 * a key could travel in.
 *
 * **The refusal you were given is the refusal that is printed.** Five market
 * causes and four model causes, nine distinct sentences with nine distinct
 * remedies, all built server-side (`market/client.py.failure_message` and
 * `llm/client.py.failure_message`). This screen never composes one of its own
 * and never rewords one — the two most repeated defects in this project are a
 * French sentence naming the wrong cause and a screen that softened an
 * engine's refusal.
 */
export function ConnectionsPage() {
  const reduced = useReducedMotion();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [modelOutcome, setModelOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [loadedConnections, loadedLlm] = await Promise.all([
          api.get<Connection[]>("/connections"),
          api.get<LlmSettings>("/assistant/llm-settings"),
        ]);
        if (cancelled) return;
        setConnections(loadedConnections);
        setLlm(loadedLlm);
        setEndpoint(loadedLlm.endpoint_url ?? "");
        setModel(loadedLlm.model_name ?? "");
      } catch (err) {
        if (!cancelled) setError(messageFor(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const needKey = useMemo(
    () => (connections ?? []).filter((item) => item.requires_key),
    [connections],
  );
  const configured = needKey.filter((item) => item.configured).length;

  function replace(updated: Connection) {
    setConnections((current) =>
      (current ?? []).map((item) => (item.provider === updated.provider ? updated : item)),
    );
  }

  async function saveKey(provider: MarketProvider, key: string) {
    setError(null);
    setBusy(provider);
    try {
      const result = await api.post<ConnectionValidation>(`/connections/${provider}`, {
        api_key: key,
      });
      replace(result);
      setOutcomes((current) => ({
        ...current,
        [provider]: result.valid
          ? {
              ok: true,
              message:
                "Clé validée par un appel réel au fournisseur, puis chiffrée et enregistrée.",
            }
          : // `reason` is one of the five causes, verbatim. Never reworded.
            { ok: false, message: result.reason ?? "Le fournisseur a refusé la clé." },
      }));
    } catch (err) {
      // The round trip itself failed — that IS an alert, and it is raised at
      // the top of the screen rather than disguised as a provider answer.
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteKey(provider: MarketProvider) {
    setError(null);
    setBusy(provider);
    try {
      await api.delete(`/connections/${provider}`);
      setConnections((current) =>
        (current ?? []).map((item) =>
          item.provider === provider
            ? { ...item, configured: false, last_used_at: null }
            : item,
        ),
      );
      setOutcomes((current) => ({
        ...current,
        [provider]: { ok: true, message: "Clé supprimée. Ce fournisseur n'est plus interrogé." },
      }));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveModel(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy("llm");
    try {
      const saved = await api.put<LlmSettings>("/assistant/llm-settings", {
        endpoint_url: endpoint,
        model_name: model,
        // An untouched field is `null`, which LEAVES a stored key in place.
        // An empty string would be a key of length zero, which is not what an
        // untouched box means.
        api_key: modelKey === "" ? null : modelKey,
      });
      setLlm(saved);
      setModelKey("");
      setModelOutcome({
        ok: true,
        message:
          "Modèle enregistré. Il n'est joint qu'au moment où vous posez une question dans l'Assistant, et sa réponse reste un commentaire.",
      });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteModel() {
    setError(null);
    setBusy("llm");
    try {
      const cleared = await api.delete<LlmSettings>("/assistant/llm-settings");
      setLlm(cleared);
      setEndpoint("");
      setModel("");
      setModelKey("");
      setModelOutcome({
        ok: true,
        message:
          "Modèle supprimé. L'Assistant continue de répondre : ses chiffres n'ont jamais dépendu d'un modèle.",
      });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="yd-connections">
      <div className="yd-connections__header">
        <h1>Réglages → Connexions</h1>
        <p className="yd-connections__lead">
          Les clés de données de marché et le modèle de langage se saisissent ici, et nulle part
          ailleurs. <strong>Tout est facultatif</strong>&nbsp;: sans aucune clé, Yieldo importe,
          catégorise, budgète, projette et répond — seules la valorisation en temps réel et le
          commentaire du modèle sont indisponibles, et chaque écran le dit à sa place.
        </p>
        <p className="yd-connections__lead yd-connections__lead--rule">
          <strong>Une clé s'écrit, elle ne se relit pas.</strong> Elle est chiffrée à
          l'enregistrement et ne ressort jamais du serveur, pas même vers cet écran. Yieldo peut
          vous dire qu'une clé existe&nbsp;; il ne peut pas vous dire laquelle, et n'affiche donc
          aucune valeur masquée qui laisserait croire le contraire.
        </p>
      </div>

      {error !== null ? (
        <p role="alert" className="yd-connections__alert" data-testid="yd-connections-error">
          {error}
        </p>
      ) : null}

      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.market}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Données de marché</h2>
          {connections === null ? (
            <div role="status" aria-busy="true" aria-label="Chargement des connexions">
              <div className="yd-skeleton yd-skeleton--patrimoine-card" aria-hidden="true" />
            </div>
          ) : (
            <>
              <p className="yd-connections__note" data-testid="yd-connections-summary">
                {configured === 0
                  ? `Aucune clé enregistrée sur les ${needKey.length} fournisseurs qui en demandent une. Les positions restent affichées à leur prix de revient, sans valeur de marché.`
                  : `${configured} ${plural(
                      configured,
                      "fournisseur est configuré",
                      "fournisseurs sont configurés",
                    )} sur les ${needKey.length} qui demandent une clé.`}
              </p>
              <ul className="yd-conns" data-testid="yd-connections-list">
                {(connections ?? []).map((connection) => (
                  <ProviderCard
                    key={connection.provider}
                    connection={connection}
                    outcome={outcomes[connection.provider] ?? null}
                    busy={busy === connection.provider}
                    onSave={(provider, key) => void saveKey(provider, key)}
                    onDelete={(provider) => void deleteKey(provider)}
                  />
                ))}
              </ul>
            </>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.model} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Modèle de langage (facultatif)</h2>

          {/* The contract that makes this feature safe to switch on, said on
              the screen that switches it on — not only in a docstring. */}
          <p className="yd-connections__contract" data-testid="yd-llm-contract">
            <strong>Le modèle ne calcule jamais.</strong> Chaque chiffre affiché par Yieldo vient
            d'un moteur déterministe, mesuré sur vos propres relevés. Le modèle reçoit ce chiffre
            déjà calculé et n'a qu'un rôle&nbsp;: le commenter en français. Rien de ce qu'il écrit
            n'est relu comme un nombre, et aucun montant à l'écran ne peut venir de lui.
          </p>
          <p className="yd-connections__note">
            N'importe quel endpoint compatible OpenAI convient&nbsp;: Ollama, LM Studio,
            llama.cpp ou vLLM en local, sans clé&nbsp;; Gemini, Claude ou OpenAI en ligne, avec une
            clé. Rien n'est envoyé tant que vous ne posez pas de question dans l'Assistant.
          </p>

          {llm === null ? (
            <div role="status" aria-busy="true" aria-label="Chargement du modèle">
              <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
            </div>
          ) : (
            <form className="yd-conn__form" onSubmit={(event) => void saveModel(event)}>
              <p className="yd-conn__state-line" data-testid="yd-llm-state">
                {llm.configured
                  ? `Modèle configuré : ${llm.model_name} sur ${llm.endpoint_url}. ${
                      llm.has_key
                        ? "Une clé est enregistrée pour cet endpoint."
                        : "Aucune clé n'est enregistrée — un endpoint local n'en demande pas."
                    }`
                  : "Aucun modèle n'est configuré. L'Assistant répond quand même : ses réponses sont celles du moteur déterministe, et elles n'ont jamais dépendu d'un modèle."}
              </p>

              <label className="yd-conn__field" htmlFor="yd-llm-endpoint">
                <span>URL de l'endpoint</span>
                <input
                  id="yd-llm-endpoint"
                  type="url"
                  value={endpoint}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="http://localhost:11434/v1"
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              </label>
              <p className="yd-conn__hint">
                La base compatible OpenAI, sans « /chat/completions » à la fin — Yieldo l'ajoute.
              </p>

              <label className="yd-conn__field" htmlFor="yd-llm-model">
                <span>Nom du modèle</span>
                <input
                  id="yd-llm-model"
                  type="text"
                  value={model}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="llama3.1:8b"
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>

              <label className="yd-conn__field" htmlFor="yd-llm-key">
                <span>{llm.has_key ? "Remplacer la clé (facultatif)" : "Clé (facultatif)"}</span>
                <input
                  id="yd-llm-key"
                  type="password"
                  value={modelKey}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="yd-llm-key-hint"
                  placeholder=""
                  onChange={(event) => setModelKey(event.target.value)}
                />
              </label>
              <p className="yd-conn__hint" id="yd-llm-key-hint">
                {WRITE_ONLY} Laissé vide, ce champ ne touche pas à la clé déjà enregistrée&nbsp;:
                un endpoint local n'en demande aucune.
              </p>

              <div className="yd-conn__actions">
                <button
                  type="submit"
                  className="yd-conn__action yd-conn__action--primary"
                  disabled={busy === "llm" || endpoint.trim() === "" || model.trim() === ""}
                >
                  {busy === "llm" ? "Enregistrement…" : "Enregistrer le modèle"}
                </button>
                {llm.configured ? (
                  <button
                    type="button"
                    className="yd-conn__action"
                    disabled={busy === "llm"}
                    onClick={() => void deleteModel()}
                  >
                    Supprimer le modèle
                  </button>
                ) : null}
              </div>

              <p
                className={`yd-conn__outcome yd-conn__outcome--${
                  modelOutcome === null ? "idle" : modelOutcome.ok ? "ok" : "bad"
                }`}
                aria-live="polite"
                data-testid="yd-llm-outcome"
              >
                {modelOutcome === null ? "" : modelOutcome.message}
              </p>
            </form>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Ce qui se passe quand vous enregistrez une clé</h2>
          <ol className="yd-connections__steps">
            <li>
              Yieldo fait <strong>un appel réel</strong> au fournisseur avec la clé que vous venez
              de saisir. C'est le seul moyen de savoir si elle fonctionne&nbsp;; une clé acceptée
              sans vérification serait un mensonge poli.
            </li>
            <li>
              Cet appel est décompté du quota, qu'il réussisse ou non&nbsp;: une clé refusée a
              quand même coûté une requête au fournisseur. Si le quota est déjà à son plafond de
              prudence, Yieldo refuse <em>avant</em> d'appeler et vous le dit.
            </li>
            <li>
              Si elle fonctionne, la clé est chiffrée puis enregistrée. Si elle ne fonctionne pas,
              rien n'est enregistré et la phrase affichée est celle du fournisseur — clé refusée,
              quota épuisé, service injoignable, symbole inconnu&nbsp;: quatre causes distinctes,
              quatre remèdes distincts.
            </li>
          </ol>
        </BentoCell>
      </BentoGrid>
    </section>
  );
}
