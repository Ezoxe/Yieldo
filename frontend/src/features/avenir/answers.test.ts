import { describe, expect, it } from "vitest";

import type { Outlook, OutlookReliability } from "../../lib/types";
import { endOfMonthAnswer, lowPointContext, reliabilityAnswer, riskPill } from "./answers";
import { OUTLOOK } from "./fixtures";

describe("endOfMonthAnswer", () => {
  it("answers the current month while more than a week of it is left", () => {
    const outlook: Outlook = { ...OUTLOOK, as_of: "2026-09-10" };
    expect(endOfMonthAnswer(outlook)?.title).toBe("Fin septembre prévue");
  });

  it("moves to the next month in the last week of this one", () => {
    const outlook: Outlook = { ...OUTLOOK, as_of: "2026-09-25" };
    expect(endOfMonthAnswer(outlook)?.title).toBe("Fin octobre prévue");
  });

  it("has nothing to say without a month end in the horizon", () => {
    expect(endOfMonthAnswer({ ...OUTLOOK, months: [] })).toBeNull();
  });
});

describe("lowPointContext", () => {
  it("names the income that comes the next day", () => {
    expect(lowPointContext(OUTLOOK)).toBe("veille de VIR SEPA ACME SAS SALAIRE");
  });

  it("says nothing when no income follows", () => {
    expect(lowPointContext({ ...OUTLOOK, events: [] })).toBeNull();
  });
});

describe("riskPill", () => {
  it("speaks of an overdraft against zero", () => {
    expect(riskPill({ ...OUTLOOK, risk: "probable" })).toEqual({
      text: "Découvert probable",
      tone: "negative",
    });
    expect(riskPill({ ...OUTLOOK, risk: "possible" }).text).toBe("Découvert possible");
    expect(riskPill({ ...OUTLOOK, risk: "none" }).text).toBe("Pas de découvert prévu");
  });

  it("speaks of the household's own floor when one is set", () => {
    const floored: Outlook = { ...OUTLOOK, threshold_source: "alert", threshold_cents: 50_000 };
    expect(riskPill({ ...floored, risk: "possible" }).text).toBe("Seuil menacé");
  });
});

describe("reliabilityAnswer", () => {
  it("quotes the one-month error and how often reality stayed inside", () => {
    const reliability: OutlookReliability = {
      scope: "checking",
      refusal: null,
      horizons: [
        { horizon_months: 1, replays: 12, mean_abs_error_cents: 33_016,
          median_abs_error_cents: 28_981, bias_cents: 5_688, inside_band: 9 },
      ],
    };
    const answer = reliabilityAnswer(reliability);
    expect(answer.kind).toBe("measured");
    if (answer.kind === "measured") {
      expect(answer.headline).toBe("±330 €");
      expect(answer.detail).toBe("à 1 mois · 9 fois sur 12 dans la fourchette");
    }
  });

  it("passes the refusal through", () => {
    const answer = reliabilityAnswer({ scope: "checking", horizons: [], refusal: "Il faut 9 mois." });
    expect(answer).toEqual({ kind: "refused", reason: "Il faut 9 mois." });
  });
});
