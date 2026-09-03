import type { MarketProvider } from "../../lib/types";

/** The five providers, as `market/quota.py`'s `PROVIDER_LABELS` spells them —
 *  the same names the backend's own French sentences use, so "aucune clé pour
 *  Finnhub" points at a row the reader can actually find on this screen.
 *
 *  Lived in `features/portfolio/MarketPanel.tsx` until Réglages → Connexions
 *  became the second reader of the same five names. One copy, so a label can
 *  never drift between the panel that reports a missing key and the screen
 *  that fixes it. */
export const PROVIDER_LABEL: Record<string, string> = {
  finnhub: "Finnhub",
  alpha_vantage: "Alpha Vantage",
  coingecko: "CoinGecko",
  frankfurter: "Frankfurter",
  exchangerate_api: "ExchangeRate-API",
};

/** What each provider is actually FOR — without this a panel is five brand
 *  names and no information. */
export const PROVIDER_ROLE: Record<string, string> = {
  finnhub: "Actions, ETF et obligations",
  alpha_vantage: "Actions (source de secours)",
  coingecko: "Cryptomonnaies",
  frankfurter: "Taux de change",
  exchangerate_api: "Taux de change (source de secours)",
};

/**
 * Where a key actually comes from, per provider.
 *
 * The screen exists so the operator never has to reach for curl again, and
 * "enter a key" is only actionable if he knows where to get one. Plain text,
 * never a link: nothing in this application opens an outbound connection the
 * household did not ask for, and a rendered anchor to a third party is a
 * request the moment it is prefetched.
 */
export const PROVIDER_SIGNUP: Record<string, string> = {
  finnhub: "Clé gratuite sur finnhub.io, rubrique « Dashboard » après inscription.",
  alpha_vantage: "Clé gratuite sur alphavantage.co, rubrique « Get free API key ».",
  exchangerate_api: "Clé gratuite sur exchangerate-api.com après inscription.",
};

/**
 * What a provider that needs NO key does, said as itself.
 *
 * Not "aucune clé enregistrée" with an empty field beside it: that reads as
 * something missing, and there is nothing missing. `requires_key` is `false`
 * for these two and the screen renders no key field at all for them — an
 * empty box would imply a step the household has to take, and it has none.
 */
export const PROVIDER_NO_KEY_NEEDED: Record<string, string> = {
  coingecko:
    "Aucune clé n'est nécessaire : l'offre publique de CoinGecko répond sans authentification, dans la limite de son plafond d'appels. Yieldo n'a donc rien à vous demander ici.",
  frankfurter:
    "Aucune clé n'est nécessaire, et il n'y a aucun plafond : Frankfurter est un service public sans authentification. Rien à saisir, rien à surveiller.",
};

export function providerLabel(provider: MarketProvider | string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}
