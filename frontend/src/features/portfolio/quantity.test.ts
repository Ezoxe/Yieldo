import { describe, expect, it } from "vitest";

import { QUANTITY_SCALE, parseQuantity, quantityToInput, sumQuantities } from "./quantity";

/** The canonical wire form: exactly `QUANTITY_SCALE` decimal places. */
function canonical(whole: string, fraction = ""): string {
  return `${whole}.${fraction.padEnd(QUANTITY_SCALE, "0")}`;
}

describe("parseQuantity", () => {
  it("reads a whole number of units", () => {
    expect(parseQuantity("12")).toEqual({ quantity: canonical("12") });
  });

  it("reads the comma a French keyboard actually types", () => {
    expect(parseQuantity("0,25")).toEqual({ quantity: canonical("0", "25") });
  });

  it("reads a dot as well, since a pasted figure often carries one", () => {
    expect(parseQuantity("0.25")).toEqual({ quantity: canonical("0", "25") });
  });

  it("ignores the spaces a pasted figure carries, including the narrow ones", () => {
    expect(parseQuantity("2 500")).toEqual({ quantity: canonical("2500") });
    expect(parseQuantity("2 500")).toEqual({ quantity: canonical("2500") });
  });

  it("keeps all eighteen decimals of a token holding exactly", () => {
    // Wei precision, the deepest scale engines/quantity.py supports. A float
    // cannot hold this, and Number() would round the last digits away.
    const result = parseQuantity("0,000000000000000001");
    expect(result).toEqual({ quantity: canonical("0", "000000000000000001") });
  });

  it("refuses a nineteenth decimal rather than truncating it, and says how many", () => {
    // engines/quantity.py raises on more than SCALE places precisely because
    // silently discarding real precision is the fallback the project forbids.
    const result = parseQuantity("0,0000000000000000019");
    expect(result).toEqual({
      error:
        "Quantité trop précise : 19 décimales ont été saisies et Yieldo n'en conserve que 18. Aucune décimale n'est arrondie en silence : retirez-en 1.",
    });
  });

  it("names the two decimals to remove when two are in excess", () => {
    const result = parseQuantity("1,00000000000000000012");
    expect(result).toEqual({
      error:
        "Quantité trop précise : 20 décimales ont été saisies et Yieldo n'en conserve que 18. Aucune décimale n'est arrondie en silence : retirez-en 2.",
    });
  });

  it("refuses something that is not a number, quoting what was typed", () => {
    expect(parseQuantity("douze")).toEqual({
      error:
        "Quantité illisible : « douze » n'est pas un nombre. Saisissez un nombre d'unités, par exemple 12 ou 0,25.",
    });
  });

  it("refuses a euro amount typed into a unit count", () => {
    // A quantity is not money. "150,00 €" here would otherwise become 150 units.
    expect(parseQuantity("150,00 €")).toEqual({
      error:
        "Quantité illisible : « 150,00 € » n'est pas un nombre. Saisissez un nombre d'unités, par exemple 12 ou 0,25.",
    });
  });

  it("refuses an empty field for what it is, not as an unreadable number", () => {
    expect(parseQuantity("   ")).toEqual({
      error: "Quantité manquante : indiquez le nombre d'unités acquises, par exemple 12 ou 0,25.",
    });
  });

  it("refuses zero and negatives with the backend's own sentence", () => {
    const positive =
      "La quantité d'un lot doit être strictement positive : un lot est une acquisition, jamais une cession.";
    expect(parseQuantity("0")).toEqual({ error: positive });
    expect(parseQuantity("0,000")).toEqual({ error: positive });
    expect(parseQuantity("-3")).toEqual({ error: positive });
  });
});

describe("quantityToInput", () => {
  it("drops the padding zeros the wire form carries", () => {
    expect(quantityToInput(canonical("12"))).toBe("12");
    expect(quantityToInput(canonical("0", "25"))).toBe("0,25");
  });

  it("keeps every significant decimal of a small holding", () => {
    expect(quantityToInput(canonical("0", "000000000000000001"))).toBe("0,000000000000000001");
  });

  it("round-trips through parseQuantity unchanged", () => {
    const wire = canonical("2500", "5");
    const shown = quantityToInput(wire);
    expect(parseQuantity(shown)).toEqual({ quantity: wire });
  });
});

describe("sumQuantities", () => {
  it("is a position's own quantity: the sum of its lots, never a stored total", () => {
    expect(sumQuantities([canonical("12"), canonical("3")])).toBe(canonical("15"));
  });

  it("sums exactly where a float cannot", () => {
    // 0.1 + 0.2 through a float is 0.30000000000000004.
    expect(sumQuantities([canonical("0", "1"), canonical("0", "2")])).toBe(canonical("0", "3"));
  });

  it("sums at the eighteenth decimal without losing a digit", () => {
    const wei = canonical("0", "000000000000000001");
    expect(sumQuantities([wei, wei, wei])).toBe(canonical("0", "000000000000000003"));
  });

  it("is zero for a position that has no lot yet", () => {
    expect(sumQuantities([])).toBe(canonical("0"));
  });
});
