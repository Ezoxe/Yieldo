import { beforeEach, describe, expect, it } from "vitest";

import { formatCents, formatCompactCents, readStoredTheme, resolveTheme } from "./theme";

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
