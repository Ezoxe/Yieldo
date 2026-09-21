import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACTOR_LABELS,
  AUTONOMY_EXPLAINED,
  AUTONOMY_LABELS,
  JOURNAL_KIND_LABELS,
  ORDER_STATUS_LABELS,
  OUTCOME_LABELS,
  OUTCOME_SHORT,
  OUTCOME_TONE,
  PROVIDER_LABELS,
  RULE_LABELS,
  VENUE_LABELS,
  labelFor,
} from "./vocabulary";

/**
 * The drift tests.
 *
 * The backend returns stable identifiers — `volatility_ceiling`, `order_sent`,
 * `too_slow` — and this module is the only place they become French. Nothing
 * else in either half would notice a rule added on one side and never learned
 * by the other: the screen would print the raw identifier and someone would
 * eventually report it as a bug. These tests read the Python source off disk,
 * exactly as `design/contrast.test.ts` reads `tokens.css`, so the drift is
 * caught on the commit that causes it.
 */

const BACKEND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../../..", "backend", "app",
);

function tupleFrom(file: string, name: string): string[] {
  const source = readFileSync(path.join(BACKEND, file), "utf8");
  const match = source.match(new RegExp(`^${name} = \\(([\\s\\S]*?)\\)`, "m"));
  if (!match) throw new Error(`${name} introuvable dans ${file}`);
  return [...match[1].matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1]);
}

describe("le vocabulaire suit le backend", () => {
  it("nomme en français chaque règle de risque que le mandat peut invoquer", () => {
    const rules = tupleFrom("engines/trading_risk.py", "RISK_RULES");
    expect(rules.length).toBeGreaterThan(10);
    const missing = rules.filter((rule) => !(rule in RULE_LABELS));
    expect(missing, `règles sans libellé français : ${missing.join(", ")}`).toEqual([]);
  });

  it("nomme chaque issue de décision, et lui donne une teinte", () => {
    const outcomes = tupleFrom("models/trade_decision.py", "DECISION_OUTCOMES");
    for (const outcome of outcomes) {
      expect(OUTCOME_LABELS, outcome).toHaveProperty(outcome);
      expect(OUTCOME_SHORT, outcome).toHaveProperty(outcome);
      expect(OUTCOME_TONE, outcome).toHaveProperty(outcome);
    }
  });

  it("nomme chaque état d'ordre", () => {
    for (const state of tupleFrom("models/trade_order.py", "ORDER_STATES")) {
      expect(ORDER_STATUS_LABELS, state).toHaveProperty(state);
    }
  });

  it("nomme chaque événement que le journal peut enregistrer", () => {
    const kinds = tupleFrom("models/trade_audit.py", "AUDIT_KINDS");
    const missing = kinds.filter((kind) => !(kind in JOURNAL_KIND_LABELS));
    expect(missing, `événements sans libellé : ${missing.join(", ")}`).toEqual([]);
  });

  it("nomme chaque mode de pilotage, et explique ce qu'il fait", () => {
    for (const mode of tupleFrom("models/trading_policy.py", "AUTONOMY_MODES")) {
      expect(AUTONOMY_LABELS, mode).toHaveProperty(mode);
      expect(AUTONOMY_EXPLAINED, mode).toHaveProperty(mode);
    }
  });

  it("nomme chaque place de marché", () => {
    for (const venue of tupleFrom("models/trading_venue.py", "TRADING_VENUES")) {
      expect(VENUE_LABELS, venue).toHaveProperty(venue);
    }
  });

  it("nomme chaque fournisseur de décision", () => {
    for (const provider of tupleFrom("decision/contract.py", "PROVIDERS")) {
      expect(PROVIDER_LABELS, provider).toHaveProperty(provider);
    }
  });

  it("nomme les trois auteurs possibles d'une entrée du journal", () => {
    expect(Object.keys(ACTOR_LABELS).sort()).toEqual(["agent", "session", "system"]);
  });
});

describe("labelFor", () => {
  it("rend le libellé quand il existe", () => {
    expect(labelFor(RULE_LABELS, "halted")).toBe("À l'arrêt");
  });

  it("rend l'identifiant plutôt que rien quand il ne le connaît pas", () => {
    // An unlabelled rule on screen is a bug someone reports; a rule that
    // vanished is a rule nobody knows fired.
    expect(labelFor(RULE_LABELS, "une_regle_inconnue")).toBe("une_regle_inconnue");
  });

  it("rend un tiret pour l'absence de règle", () => {
    expect(labelFor(RULE_LABELS, null)).toBe("—");
  });
});
