import { describe, expect, it } from "vitest";

import {
  QUANTITY_DECIMALS,
  formatBps,
  formatLatency,
  formatProbability,
  formatQuantity,
  quantityIsShortened,
  remainingMinutes,
} from "./format";

describe("formatBps", () => {
  it("reads basis points as a French percentage", () => {
    expect(formatBps(347)).toBe("3,47 %");
  });

  it("signs only when asked, and uses the typographic minus", () => {
    expect(formatBps(347, { signed: true })).toBe("+3,47 %");
    expect(formatBps(-347)).toBe("−3,47 %");
    expect(formatBps(347)).not.toContain("+");
  });

  it("groups thousands with the narrow no-break space", () => {
    expect(formatBps(1_234_567)).toContain(" ");
  });
});

describe("formatProbability", () => {
  it("reads a probability as a whole percentage", () => {
    expect(formatProbability(6_500)).toBe("65 %");
    expect(formatProbability(5_550)).toBe("56 %");
  });
});

describe("formatLatency", () => {
  it("keeps milliseconds under a second", () => {
    expect(formatLatency(84)).toBe("84 ms");
  });

  it("says zero rather than nothing for a model that answered instantly", () => {
    // A constrained small model really can answer inside a millisecond, and
    // « — » would hide the property it was chosen for.
    expect(formatLatency(0)).toBe("0 ms");
  });

  it("switches to seconds past a thousand", () => {
    expect(formatLatency(1_200)).toBe("1,2 s");
  });

  it("says nothing when there is nothing to say", () => {
    expect(formatLatency(null)).toBe("—");
  });
});

describe("formatQuantity", () => {
  it("uses the French decimal comma", () => {
    // « 11.2073 » in a French interface is a defect on screen.
    expect(formatQuantity("11.207306749155836804")).toBe("11,20730674");
  });

  it("shortens to eight decimals rather than printing the stored eighteen", () => {
    expect(formatQuantity("11.207306749155836804").split(",")[1]).toHaveLength(
      QUANTITY_DECIMALS,
    );
  });

  it("drops trailing zeros", () => {
    expect(formatQuantity("0.010000000000000000")).toBe("0,01");
  });

  it("leaves a whole count alone", () => {
    expect(formatQuantity("3")).toBe("3");
  });

  it("reads a fully zero fraction as a whole number", () => {
    expect(formatQuantity("7.000000000000000000")).toBe("7");
  });

  it("says nothing for nothing", () => {
    expect(formatQuantity(null)).toBe("—");
  });

  it("reports when it had to drop digits, so the caller can show the exact one", () => {
    expect(quantityIsShortened("11.207306749155836804")).toBe(true);
    expect(quantityIsShortened("0.010000000000000000")).toBe(false);
    expect(quantityIsShortened("3")).toBe(false);
  });
});

describe("remainingMinutes", () => {
  const now = new Date("2026-09-20T10:00:00Z");

  it("counts the minutes left on an arming", () => {
    expect(remainingMinutes("2026-09-20T10:25:00Z", now)).toBe(25);
  });

  it("returns nothing once it has expired, never a negative count", () => {
    // « il reste −3 min » would be worse than saying nothing.
    expect(remainingMinutes("2026-09-20T09:57:00Z", now)).toBeNull();
  });

  it("returns nothing when there is no arming at all", () => {
    expect(remainingMinutes(null, now)).toBeNull();
  });
});
