import { beforeEach, describe, expect, it } from "vitest";

import { formatCents, formatCompactCents, parseCents, readStoredTheme, resolveTheme } from "./theme";

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
