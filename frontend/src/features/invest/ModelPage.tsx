import { useEffect, useState } from "react";

import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { PageHead } from "../../design/PageHead";
import { PageSkeleton } from "../../design/PageSkeleton";
import { DecisionModelIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";
import { useApiQuery, useInvalidate } from "../../lib/useApiQuery";
import type { InvestDecisionModel, InvestModelCheck } from "../../lib/types";
import { formatLatency, formatProbability } from "./format";
import { MassBars } from "./MassBars";
import { PROVIDER_LABELS } from "./vocabulary";
import "./invest.css";

const PROVIDERS = ["local", "jev", "laya", "replay"] as const;

/** What each provider is, and the trade it asks you to make. */
const PROVIDER_NOTES: Record<string, string> = {
  local:
    "N'importe quel point d'accès compatible OpenAI capable de décodage contraint — vLLM, "
    + "llama.cpp, Ollama — avec un petit modèle ouvert. Yieldo envoie un schéma JSON avec "
    + "chaque question : le décodeur ne peut produire qu'une réponse du bon type. C'est la "
    + "propriété qui rend un modèle sûr devant de l'argent, et elle ne dépend d'aucun "
    + "fournisseur. Rien ne sort de chez vous.",
  jev:
    "Le modèle « System One » de TypeSafe : il ne rend pas du texte mais une décision typée, "
    + "en quelques dizaines de millisecondes. En contrepartie, les indicateurs et la position "
    + "quittent la machine à chaque décision. C'est un choix légitime, et ce n'est pas le "
    + "choix par défaut.",
  laya:
    "Un encodeur, pas un LLM : ModernBERT et une tête de décision, 421 M de paramètres, sur "
    + "votre propre serveur — un CPU suffit, environ 0,6 s par question. Il rend une décision "
    + "typée et, en plus, toute sa masse de probabilité par option : vous voyez si « acheter » "
    + "à 36 % est une décision ou un pile-ou-face. Entraîné sur du texte métier, pas sur des "
    + "séries de prix : le panneau « Le modèle contre les règles » dit s'il bat quatre règles "
    + "de momentum. Le checkpoint multilingual est celui qui lit l'état français que Yieldo "
    + "envoie. Rien ne sort de chez vous.",
  replay:
    "Des règles lisibles, exécutées par Yieldo, sans réseau : moyennes, momentum, RSI, "
    + "position dans le canal. Ce n'est jamais un repli automatique — il faut le choisir. "
    + "Il sert de référence : un modèle ne vaut sa latence que s'il bat des règles que "
    + "n'importe qui peut lire.",
};

/**
 * Quel modèle tranche, et la preuve qu'il répond dans le contrat.
 *
 * Enregistrer valide par une vraie question — celle du pilotage, sur un
 * instrument de test — et affiche la réponse et sa latence. Un modèle qui
 * échoue ici échouerait au premier instrument du premier tour ; le découvrir
 * sur cet écran ne coûte rien.
 */
export function ModelPage() {
  const model = useApiQuery<InvestDecisionModel>("/invest/model");
  const invalidate = useInvalidate();

  const [provider, setProvider] = useState<string>("local");
  const [endpoint, setEndpoint] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [timeout, setTimeoutMs] = useState("2000");
  const [result, setResult] = useState<InvestModelCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!model.data || hydrated) return;
    setProvider(model.data.provider);
    setEndpoint(model.data.endpoint_url ?? "");
    setName(model.data.model_name ?? "");
    setTimeoutMs(String(model.data.timeout_ms));
    setHydrated(true);
  }, [model.data, hydrated]);

  if (model.isPending) return <PageSkeleton />;

  const save = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(
        await api.put<InvestModelCheck>("/invest/model", {
          provider,
          endpoint_url: endpoint.trim() || null,
          model_name: name.trim() || null,
          // A key left empty keeps the one already stored: editing a model
          // name must not require retyping a secret you cannot read back.
          api_key: key.trim() || null,
          timeout_ms: Number(timeout) || null,
        }),
      );
      setKey("");
      await invalidate("/invest/model");
    } catch (error) {
      setResult({
        valid: false,
        latency_ms: null,
        message: error instanceof ApiError ? error.detail : "Le modèle n'a pas pu être enregistré.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="yd-invest-page">
      <PageHead
        icon={DecisionModelIcon}
        title="Modèle de décision"
        shortLead="Qui tranche, et la preuve qu'il répond dans le contrat."
      >
        <p>
          Le modèle répond à trois questions typées&nbsp;: un sens (« acheter », « vendre »,
          « ne rien faire »), une conviction de 0 à 10, et la probabilité que le mouvement se
          poursuive. Une réponse hors de ce type est <strong>écartée, jamais corrigée</strong>
          {" "}— un modèle qui invente une option n'en décide aucune. Il ne choisit jamais de
          taille de position&nbsp;: celle-ci est calculée par Yieldo.
        </p>
      </PageHead>

      <BentoGrid>
        <BentoCell span={{ base: 1, md: 6, lg: 7 }}>
          <PanelHead icon={DecisionModelIcon}>Le fournisseur</PanelHead>
          <div className="yd-invest-form">
            <fieldset className="yd-invest-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>Qui répond</legend>
              {PROVIDERS.map((value) => (
                <label key={value} className="yd-invest-check">
                  <input type="radio" name="provider" value={value}
                         checked={provider === value}
                         onChange={() => setProvider(value)} />
                  <span>
                    <strong>{PROVIDER_LABELS[value]}</strong>
                    <br />
                    <small>{PROVIDER_NOTES[value]}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            {provider !== "replay" ? (
              <div className="yd-invest-grid">
                <label className="yd-invest-field">
                  <span>Adresse du point d'accès</span>
                  <input className="yd-input" value={endpoint}
                         onChange={(event) => setEndpoint(event.target.value)}
                         placeholder={
                           provider === "jev"
                             ? "https://api.typesafe.ai/v1/systemone"
                             : provider === "laya"
                               ? "http://192.168.1.172:8100"
                               : "http://192.168.1.20:8000/v1"
                         } />
                  {provider === "local" ? (
                    <small>
                      L'adresse de base compatible OpenAI, celle qui se termine par /v1.
                    </small>
                  ) : provider === "laya" ? (
                    <small>
                      L'adresse du serveur Laya de <code>tools/laya-server</code>, port 8100
                      par défaut. Le checkpoint chargé est lu sur le serveur.
                    </small>
                  ) : (
                    <small>Laissez vide pour l'adresse officielle.</small>
                  )}
                </label>
                {provider !== "laya" ? (
                  <label className="yd-invest-field">
                    <span>Nom du modèle</span>
                    <input className="yd-input" value={name}
                           onChange={(event) => setName(event.target.value)}
                           placeholder={provider === "jev" ? "jev-latest" : "qwen3-4b-instruct"} />
                  </label>
                ) : null}
                <label className="yd-invest-field">
                  <span>Clé{model.data?.has_key ? " (une clé est déjà enregistrée)" : ""}</span>
                  <input className="yd-input" type="password" value={key} autoComplete="off"
                         onChange={(event) => setKey(event.target.value)} />
                  <small>
                    Chiffrée avant d'être écrite, jamais relue. Laissez vide pour conserver
                    celle qui est déjà enregistrée.
                  </small>
                </label>
                <label className="yd-invest-field">
                  <span>Délai accordé (ms)</span>
                  <input className="yd-input yd-num" inputMode="numeric" value={timeout}
                         onChange={(event) => setTimeoutMs(event.target.value)} />
                  {provider === "laya" ? (
                    <small>
                      En millisecondes. Laya sur CPU met environ une seconde par question&nbsp;;
                      sur une machine plus lente, montez à 5 000 plutôt que de voir des
                      décisions écartées pour lenteur.
                    </small>
                  ) : (
                    <small>
                      En millisecondes, pas en secondes&nbsp;: une décision qui n'arrive pas en
                      deux secondes porte sur un marché qui a bougé. Elle est écartée.
                    </small>
                  )}
                </label>
              </div>
            ) : null}

            <div className="yd-invest-actions">
              <button type="button" className="yd-button yd-button--primary"
                      onClick={() => void save()} disabled={busy}>
                {busy ? "Interrogation du modèle…" : "Enregistrer et interroger"}
              </button>
            </div>

            {result ? (
              <p className={`yd-note yd-note--${result.valid ? "positive" : "negative"}`}
                 role="status">
                {result.message}
                {result.latency_ms !== null ? ` (${formatLatency(result.latency_ms)})` : ""}
              </p>
            ) : null}

            {result?.health ? (
              <div role="group" aria-label="Carte de santé du serveur">
                <h4 className="yd-detail__heading">Le serveur</h4>
                <dl className="yd-health">
                  <div><dt>Checkpoint</dt><dd>{result.health.checkpoint ?? "—"}</dd></div>
                  <div><dt>Machine</dt><dd>{result.health.device ?? "—"}</dd></div>
                  <div>
                    <dt>Threads</dt>
                    <dd className="yd-num">{result.health.threads ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Contexte</dt>
                    <dd className="yd-num">
                      {result.health.context_tokens
                        ? `${result.health.context_tokens.toLocaleString("fr-FR")} tokens`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Chauffe</dt>
                    <dd className="yd-num">{formatLatency(result.health.warmup_ms)}</dd>
                  </div>
                  <div>
                    <dt>Médiane</dt>
                    <dd className="yd-num">{formatLatency(result.health.latency_p50_ms)}</dd>
                  </div>
                  <div>
                    <dt>Au pire (p95)</dt>
                    <dd className="yd-num">{formatLatency(result.health.latency_p95_ms)}</dd>
                  </div>
                  <div>
                    <dt>Prédictions</dt>
                    <dd className="yd-num">{result.health.predictions ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Versions</dt>
                    <dd className="yd-num">
                      {[result.health.laya_version && `laya ${result.health.laya_version}`,
                        result.health.torch_version && `torch ${result.health.torch_version}`]
                        .filter(Boolean).join(" · ") || "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {result?.mass_bps ? (
              <div>
                <h4 className="yd-detail__heading">
                  Ce qu'il a répondu à la question de test
                </h4>
                <MassBars mass={result.mass_bps} chosen={result.choice ?? null} />
                {result.act_bps !== null && result.act_bps !== undefined ? (
                  <p className="yd-feed__time">
                    Probabilité d'agir plutôt que d'escalader&nbsp;:
                    agir {formatProbability(result.act_bps)}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 5 }}>
          <PanelHead icon={DecisionModelIcon}>Monter un modèle chez soi</PanelHead>
          <p className="yd-note">
            Le décodage contraint est ce qui garantit une réponse typée. vLLM l'expose par
            <code> response_format</code>, et c'est ce que Yieldo envoie&nbsp;:
          </p>
          <div className="yd-code">{`vllm serve Qwen/Qwen3-4B-Instruct \\
  --guided-decoding-backend xgrammar \\
  --host 0.0.0.0 --port 8000`}</div>
          <p className="yd-note">
            Puis, sur cet écran&nbsp;: adresse <code>http://votre-vps:8000/v1</code>, nom
            <code> Qwen/Qwen3-4B-Instruct</code>. Un modèle de cette taille répond en quelques
            dizaines de millisecondes sur un GPU modeste, et en quelques centaines sur un CPU.
          </p>
          <p className="yd-note yd-push-down">
            Ollama fonctionne aussi&nbsp;: <code>ollama serve</code>, puis l'adresse
            <code> http://localhost:11434/v1</code>. Plus simple à lancer, un peu plus lent.
          </p>
        </BentoCell>
      </BentoGrid>
    </div>
  );
}
