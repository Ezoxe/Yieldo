import { describe, expect, it } from "vitest";

import { partFor, universeFor } from "./registry";

const transport = { slug: "transport", name: "Transport" };

describe("universeFor", () => {
  it("opens the car on the seeded Transport family, with no part in front", () => {
    expect(universeFor({ ...transport, parent: null })).toEqual({ universe: "car", focus: null });
  });

  it("puts each seeded child's part in front", () => {
    const cases: Array<[string, string, string]> = [
      ["transport-carburant", "Carburant", "fuel"],
      ["transport-entretien", "Entretien véhicule", "engine"],
      ["transport-assurance", "Assurance véhicule", "cage"],
      ["transport-peage", "Péage et stationnement", "toll"],
    ];
    for (const [slug, name, part] of cases) {
      expect(universeFor({ slug, name, parent: transport })).toEqual({ universe: "car", focus: part });
    }
  });

  it("gives no scene to a child the car has no part for", () => {
    expect(universeFor({ slug: "transport-commun", name: "Transports en commun", parent: transport })).toBeNull();
    expect(universeFor({ slug: "transport-voyage", name: "Billets et voyages", parent: transport })).toBeNull();
  });

  it("reads a child through its parent before its own name", () => {
    // « Assurance auto » names a car, but under Transport it is the cage.
    expect(universeFor({ slug: "assurance-auto", name: "Assurance auto", parent: transport })).toEqual({
      universe: "car",
      focus: "cage",
    });
  });

  it("recognises a family the household named itself", () => {
    expect(universeFor({ slug: "ma-voiture", name: "Ma voiture", parent: null })).toEqual({
      universe: "car",
      focus: null,
    });
    expect(universeFor({ slug: "essence", name: "Essence", parent: { slug: "ma-voiture", name: "Ma voiture" } })).toEqual({
      universe: "car",
      focus: "fuel",
    });
  });

  it("opens a lone root part on unambiguous words only", () => {
    expect(universeFor({ slug: "essence", name: "Essence", parent: null })).toEqual({ universe: "car", focus: "fuel" });
    expect(universeFor({ slug: "peage", name: "Péage", parent: null })).toEqual({ universe: "car", focus: "toll" });
    // Could be the house or the car: no guess.
    expect(universeFor({ slug: "assurance", name: "Assurance", parent: null })).toBeNull();
    expect(universeFor({ slug: "entretien", name: "Entretien", parent: null })).toBeNull();
  });

  it("does not take a home insurance for the car: it is the house's roof", () => {
    const logement = { slug: "logement", name: "Logement" };
    expect(universeFor({ slug: "logement-assurance", name: "Assurance habitation", parent: logement })).toEqual({
      universe: "house",
      focus: "roof",
    });
  });

  it("does not read « autoroute » or « autres » as a car family", () => {
    expect(universeFor({ slug: "autres", name: "Autres dépenses", parent: null })).toBeNull();
    expect(universeFor({ slug: "autoroute", name: "Autoroute", parent: null })).toEqual({
      universe: "car",
      focus: "toll",
    });
  });
});

describe("universeFor — the house", () => {
  const logement = { slug: "logement", name: "Logement" };

  it("opens the house on the seeded Logement family", () => {
    expect(universeFor({ ...logement, parent: null })).toEqual({ universe: "house", focus: null });
  });

  it("puts each seeded child where it lives in the house", () => {
    const cases: Array<[string, string, string]> = [
      ["logement-loyer", "Loyer", "door"],
      ["logement-credit", "Crédit immobilier", "door"],
      ["logement-charges", "Charges et copropriété", "water"],
      ["logement-energie", "Énergie", "power"],
      ["logement-internet", "Internet et téléphone", "net"],
      ["logement-assurance", "Assurance habitation", "roof"],
      ["logement-travaux", "Travaux et entretien", "workshop"],
    ];
    for (const [slug, name, part] of cases) {
      expect(universeFor({ slug, name, parent: logement })).toEqual({ universe: "house", focus: part });
    }
  });

  it("places the household's own names under Logement", () => {
    expect(universeFor({ slug: "eau", name: "Eau", parent: logement })).toEqual({ universe: "house", focus: "water" });
    expect(universeFor({ slug: "gaz", name: "Gaz", parent: logement })).toEqual({ universe: "house", focus: "power" });
  });

  it("opens a lone root part of the house on unambiguous words", () => {
    expect(universeFor({ slug: "electricite", name: "Électricité", parent: null })).toEqual({ universe: "house", focus: "power" });
    expect(universeFor({ slug: "internet", name: "Internet", parent: null })).toEqual({ universe: "house", focus: "net" });
    expect(universeFor({ slug: "assurance-habitation", name: "Assurance habitation", parent: null })).toEqual({
      universe: "house",
      focus: "roof",
    });
    expect(universeFor({ slug: "loyer", name: "Loyer", parent: null })).toEqual({ universe: "house", focus: "door" });
  });
});

describe("partFor", () => {
  it("prefers the seeded slug to the words of the name", () => {
    expect(partFor("car", { slug: "transport-entretien", name: "Assurance (renommée)" })).toBe("engine");
  });

  it("returns null for a category the universe has no part for", () => {
    expect(partFor("car", { slug: "x", name: "Billets et voyages" })).toBeNull();
  });
});
