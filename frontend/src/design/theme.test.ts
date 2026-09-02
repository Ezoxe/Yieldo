import { beforeEach, describe, expect, it } from "vitest";

import {
  centsToInput,
  formatCents,
  formatCompactCents,
  formatQuantity,
  formatRateBps,
  parseCents,
  readStoredTheme,
  resolveTheme,
} from "./theme";

describe("formatCents", () => {
  beforeEach(() => localStorage.clear());

  it("formats a debit with a typographic minus and a euro sign", () => {
    expect(formatCents(-4732)).toBe("−47,32 €");
  });

  it("formats a credit without a plus sign by default", () => {
    expect(formatCents(245000)).toBe("2 450,00 €");
  });

  it("can force an explicit sign for deltas", () => {
    expect(formatCents(4180, { signed: true })).toBe("+41,80 €");
    expect(formatCents(-4180, { signed: true })).toBe("−41,80 €");
  });

  it("formats zero without a sign", () => {
    expect(formatCents(0)).toBe("0,00 €");
  });

  it("can omit decimals for dense tables", () => {
    expect(formatCents(-4732, { decimals: 0 })).toBe("−47 €");
  });
});

describe("formatCompactCents", () => {
  it("shortens large amounts", () => {
    expect(formatCompactCents(18432000)).toBe("184,3 k€");
    expect(formatCompactCents(18432000000)).toBe("184,3 M€");
  });

  it("keeps small amounts readable", () => {
    expect(formatCompactCents(4732)).toBe("47 €");
  });
});

describe("formatRateBps", () => {
  it("prints basis points as a French percentage", () => {
    expect(formatRateBps(490)).toBe("4,90 %");
    expect(formatRateBps(500)).toBe("5,00 %");
  });

  it("prints a debt ratio far past the HCSF threshold rather than clamping it", () => {
    // The operator's own: 19 610 bps against a 3 500 bps threshold. A screen
    // that clamped this would be hiding the whole answer.
    expect(formatRateBps(19_610)).toBe("196,10 %");
  });

  it("uses the typographic minus, like formatCents", () => {
    expect(formatRateBps(-125)).toBe("−1,25 %");
  });
});

describe("centsToInput", () => {
  it("renders integer cents as the text a euro field shows", () => {
    expect(centsToInput(150_000)).toBe("1500,00");
    expect(centsToInput(870)).toBe("8,70");
  });

  it("pads a single-digit cent rather than dropping it", () => {
    expect(centsToInput(105)).toBe("1,05");
  });

  it("round-trips through parseCents, which is the only reason it exists", () => {
    for (const cents of [0, 1, 870, 105, 150_000, 4_000_000, -74_619]) {
      expect(parseCents(centsToInput(cents))).toBe(cents);
    }
  });
});

describe("parseCents", () => {
  it("reads a plain euro amount", () => {
    expect(parseCents("300")).toBe(30000);
  });

  it("reads a French decimal comma", () => {
    expect(parseCents("300,50")).toBe(30050);
  });

  it("reads a dot as well, because keyboards differ", () => {
    expect(parseCents("300.50")).toBe(30050);
  });

  it("survives the spaces and the euro sign formatCents produces", () => {
    // formatCents emits narrow no-break spaces and a trailing "€"; a user who
    // copies a figure off the screen and pastes it back must get it back.
    expect(parseCents(formatCents(123456))).toBe(123456);
  });

  it("pads a single decimal digit rather than reading it as cents", () => {
    expect(parseCents("300,5")).toBe(30050);
  });

  it("never goes through a float", () => {
    // 0.1 + 0.2 territory: 8.70 EUR through parseFloat*100 gives 869.9999...
    expect(parseCents("8,70")).toBe(870);
    expect(parseCents("1145,29")).toBe(114529);
  });

  it("refuses more than two decimals rather than silently rounding", () => {
    expect(parseCents("300,505")).toBeNull();
  });

  it("refuses anything that is not a number", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("-")).toBeNull();
  });

  it("reads back the typographic minus formatCents emits for a debit", () => {
    expect(parseCents(formatCents(-4732))).toBe(-4732);
  });
});

describe("theme resolution", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to system when nothing is stored", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("reads a stored preference", () => {
    localStorage.setItem("yieldo.theme", "light");
    expect(readStoredTheme()).toBe("light");
  });

  it("ignores a corrupted stored value rather than crashing", () => {
    localStorage.setItem("yieldo.theme", "neon");
    expect(readStoredTheme()).toBe("system");
  });

  it("resolves system against the media query result", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });
});


describe("formatQuantity", () => {
  it("trims the canonical 18-decimal scale down to what was actually held", () => {
    expect(formatQuantity("12.000000000000000000")).toBe("12");
    expect(formatQuantity("0.250000000000000000")).toBe("0,25");
  });

  it("keeps every digit of a holding that genuinely is that small", () => {
    // 15 satoshis-worth. A float cannot hold this, which is why the whole
    // function works on the string.
    expect(formatQuantity("0.000000015000000000")).toBe("0,000000015");
  });

  it("uses a French comma, never a decimal point", () => {
    expect(formatQuantity("1.5")).toBe("1,5");
    expect(formatQuantity("1.5")).not.toContain(".");
  });

  it("groups a large unit count with the narrow no-break space", () => {
    expect(formatQuantity("1234567.000000000000000000")).toBe("1 234 567");
  });

  it("prints a whole zero as a bare zero, never as an empty string", () => {
    expect(formatQuantity("0.000000000000000000")).toBe("0");
  });

  it("carries no currency symbol — a quantity is not money", () => {
    expect(formatQuantity("12.000000000000000000")).not.toContain("€");
  });

  it("is not formatCents: the same text through each gives different answers", () => {
    // The trap this function exists to prevent. `formatCents` would read the
    // quantity as an integer number of cents; these must never agree.
    const held = "12.000000000000000000";
    expect(formatQuantity(held)).toBe("12");
    expect(formatCents(Number(held))).not.toBe("12");
  });

  it("renders a negative quantity with the typographic minus", () => {
    expect(formatQuantity("-3.500000000000000000")).toBe("−3,5");
  });
});
