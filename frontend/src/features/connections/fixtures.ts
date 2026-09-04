import type { Connection, LlmSettings } from "../../lib/types";

/** The operator's ACTUAL state, as `GET /api/connections` returns it on his
 *  own installation: no key anywhere, every quota pool untouched. Frankfurter
 *  and CoinGecko need none; the other three do and have none. */
export const CONNECTIONS: Connection[] = [
  {
    provider: "finnhub",
    configured: false,
    requires_key: true,
    last_used_at: null,
    quota: { used: 0, limit: 60, ceiling: 48, remaining: 48, reset_at: null, can_call: true },
  },
  {
    provider: "alpha_vantage",
    configured: false,
    requires_key: true,
    last_used_at: null,
    quota: { used: 0, limit: 25, ceiling: 20, remaining: 20, reset_at: null, can_call: true },
  },
  {
    provider: "coingecko",
    configured: false,
    requires_key: false,
    last_used_at: null,
    quota: { used: 0, limit: 30, ceiling: 24, remaining: 24, reset_at: null, can_call: true },
  },
  {
    provider: "frankfurter",
    configured: false,
    requires_key: false,
    last_used_at: null,
    quota: {
      used: 0,
      limit: null,
      ceiling: null,
      remaining: null,
      reset_at: null,
      can_call: true,
    },
  },
  {
    provider: "exchangerate_api",
    configured: false,
    requires_key: true,
    last_used_at: null,
    quota: {
      used: 0,
      limit: 1500,
      ceiling: 1200,
      remaining: 1200,
      reset_at: "2026-10-01T00:00:00Z",
      can_call: true,
    },
  },
];

/** Finnhub after a key has been accepted: `configured` is true, `last_used_at`
 *  is set, and there is still NO field anywhere that could carry the key. */
export const CONNECTIONS_WITH_FINNHUB: Connection[] = CONNECTIONS.map((item) =>
  item.provider === "finnhub"
    ? {
        ...item,
        configured: true,
        last_used_at: "2026-09-03T09:12:00Z",
        quota: { ...item.quota, used: 1, remaining: 47 },
      }
    : item,
);

export const LLM_UNSET: LlmSettings = {
  configured: false,
  endpoint_url: null,
  model_name: null,
  has_key: false,
  // Le défaut de l'application : jamais null, parce qu'un plafond s'applique
  // toujours, même quand personne n'en a choisi un.
  timeout_seconds: 120,
};

export const LLM_LOCAL: LlmSettings = {
  configured: true,
  endpoint_url: "http://localhost:11434/v1",
  model_name: "llama3.1:8b",
  has_key: false,
  // Relevé au-dessus du défaut : un modèle local qui raisonne avant de
  // répondre dépasse régulièrement la minute.
  timeout_seconds: 120,
};
