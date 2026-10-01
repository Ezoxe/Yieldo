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

describe("universeFor — the living room", () => {
  const abonnements = { slug: "abonnements", name: "Abonnements" };

  it("opens the living room on the seeded Abonnements family", () => {
    expect(universeFor({ ...abonnements, parent: null })).toEqual({ universe: "salon", focus: null });
  });

  it("puts each seeded subscription on what it is used on", () => {
    const cases: Array<[string, string, string]> = [
      ["abonnements-streaming", "Streaming", "tv"],
      ["abonnements-logiciels", "Logiciels et services", "laptop"],
      ["abonnements-presse", "Presse", "press"],
      ["abonnements-salle", "Salle de sport", "gym"],
    ];
    for (const [slug, name, part] of cases) {
      expect(universeFor({ slug, name, parent: abonnements })).toEqual({ universe: "salon", focus: part });
    }
  });

  it("leaves the Loisirs family's sport to the entrance hall", () => {
    expect(universeFor({ slug: "loisirs-sport", name: "Sport", parent: { slug: "loisirs", name: "Loisirs" } })).toEqual({
      universe: "hall",
      focus: "bike",
    });
  });
});

describe("universeFor — the kitchen", () => {
  const alimentation = { slug: "alimentation", name: "Alimentation" };

  it("opens the kitchen on the seeded Alimentation family", () => {
    expect(universeFor({ ...alimentation, parent: null })).toEqual({ universe: "kitchen", focus: null });
  });

  it("puts each seeded child where it is eaten", () => {
    const cases: Array<[string, string, string]> = [
      ["alimentation-courses", "Courses", "fridge"],
      ["alimentation-restaurant", "Restaurants", "plate"],
      ["alimentation-livraison", "Livraison", "delivery"],
      ["alimentation-cafe", "Cafés et bars", "coffee"],
    ];
    for (const [slug, name, part] of cases) {
      expect(universeFor({ slug, name, parent: alimentation })).toEqual({ universe: "kitchen", focus: part });
    }
  });
});

describe("universeFor — the doctor's office", () => {
  const sante = { slug: "sante", name: "Santé" };

  it("opens the doctor's office on the seeded Santé family", () => {
    expect(universeFor({ ...sante, parent: null })).toEqual({ universe: "clinic", focus: null });
  });

  it("puts each seeded child where it is paid for in the office", () => {
    const cases: Array<[string, string, string]> = [
      ["sante-medecin", "Consultations", "stethoscope"],
      ["sante-pharmacie", "Pharmacie", "medicine"],
      ["sante-mutuelle", "Mutuelle", "reader"],
      ["sante-optique", "Optique et dentaire", "glasses"],
    ];
    for (const [slug, name, part] of cases) {
      expect(universeFor({ slug, name, parent: sante })).toEqual({ universe: "clinic", focus: part });
    }
  });

  it("places the household's own names under Santé", () => {
    expect(universeFor({ slug: "dentiste", name: "Consultation dentiste", parent: sante })).toEqual({
      universe: "clinic",
      focus: "glasses",
    });
    expect(universeFor({ slug: "kine", name: "Kinésithérapeute", parent: sante })).toEqual({
      universe: "clinic",
      focus: "stethoscope",
    });
    expect(universeFor({ slug: "medicaments", name: "Médicaments", parent: sante })).toEqual({
      universe: "clinic",
      focus: "medicine",
    });
  });

  it("recognises a health family the household named itself, but not its insurance", () => {
    expect(universeFor({ slug: "frais-medicaux", name: "Frais médicaux", parent: null })).toEqual({
      universe: "clinic",
      focus: null,
    });
    expect(universeFor({ slug: "mutuelle-sante", name: "Mutuelle santé", parent: null })).toEqual({
      universe: "clinic",
      focus: "reader",
    });
    expect(universeFor({ slug: "complementaire", name: "Complémentaire santé", parent: null })).toEqual({
      universe: "clinic",
      focus: "reader",
    });
  });

  it("opens a lone root part of the office on unambiguous words only", () => {
    expect(universeFor({ slug: "pharmacie", name: "Pharmacie", parent: null })).toEqual({
      universe: "clinic",
      focus: "medicine",
    });
    expect(universeFor({ slug: "lunettes", name: "Lunettes", parent: null })).toEqual({
      universe: "clinic",
      focus: "glasses",
    });
    expect(universeFor({ slug: "medecin", name: "Médecin", parent: null })).toEqual({
      universe: "clinic",
      focus: "stethoscope",
    });
    // A consultant's invoices as much as a doctor's: no guess.
    expect(universeFor({ slug: "consultations", name: "Consultations", parent: null })).toBeNull();
  });
});

describe("universeFor — the entrance hall", () => {
  const loisirs = { slug: "loisirs", name: "Loisirs" };

  it("opens the entrance hall on the seeded Loisirs family", () => {
    expect(universeFor({ ...loisirs, parent: null })).toEqual({ universe: "hall", focus: null });
  });

  it("puts each seeded child where it waits by the door", () => {
    const cases: Array<[string, string, string]> = [
      ["loisirs-sorties", "Sorties et culture", "tickets"],
      ["loisirs-sport", "Sport", "bike"],
      ["loisirs-vacances", "Vacances", "suitcase"],
      ["loisirs-hobbies", "Loisirs et hobbies", "guitar"],
    ];
    for (const [slug, name, part] of cases) {
      expect(universeFor({ slug, name, parent: loisirs })).toEqual({ universe: "hall", focus: part });
    }
  });

  it("places the household's own names under Loisirs", () => {
    expect(universeFor({ slug: "cinema", name: "Cinéma", parent: loisirs })).toEqual({ universe: "hall", focus: "tickets" });
    expect(universeFor({ slug: "piscine", name: "Piscine", parent: loisirs })).toEqual({ universe: "hall", focus: "bike" });
    expect(universeFor({ slug: "livres", name: "Livres et musique", parent: loisirs })).toEqual({
      universe: "hall",
      focus: "guitar",
    });
    // A club of any kind is not the bike: no guess on « Club Med ».
    expect(universeFor({ slug: "club-med", name: "Club Med", parent: loisirs })).toBeNull();
  });

  it("opens a lone root part of the hall on unambiguous words only", () => {
    expect(universeFor({ slug: "cinema", name: "Cinéma", parent: null })).toEqual({ universe: "hall", focus: "tickets" });
    expect(universeFor({ slug: "vacances", name: "Vacances", parent: null })).toEqual({ universe: "hall", focus: "suitcase" });
    expect(universeFor({ slug: "velo", name: "Vélo", parent: null })).toEqual({ universe: "hall", focus: "bike" });
    // Outings or money going out: no guess.
    expect(universeFor({ slug: "sorties", name: "Sorties", parent: null })).toBeNull();
    // Travel tickets are the car's family's business, not the suitcase's.
    expect(universeFor({ slug: "voyages", name: "Voyages", parent: null })).toBeNull();
  });
});

describe("universeFor — the dressing room", () => {
  const achats = { slug: "achats", name: "Achats" };

  it("opens the dressing room on the seeded Achats family", () => {
    expect(universeFor({ ...achats, parent: null })).toEqual({ universe: "dressing", focus: null });
  });

  it("puts each seeded child where it is kept", () => {
    const cases: Array<[string, string, string]> = [
      ["achats-vetements", "Vêtements", "wardrobe"],
      ["achats-equipement", "Équipement et high-tech", "tech"],
      ["achats-maison", "Maison et décoration", "lamp"],
      ["achats-cadeaux", "Cadeaux", "gifts"],
    ];
    for (const [slug, name, part] of cases) {
      expect(universeFor({ slug, name, parent: achats })).toEqual({ universe: "dressing", focus: part });
    }
  });

  it("places the household's own names under Achats", () => {
    expect(universeFor({ slug: "chaussures", name: "Chaussures", parent: achats })).toEqual({
      universe: "dressing",
      focus: "wardrobe",
    });
    expect(universeFor({ slug: "informatique", name: "Informatique", parent: achats })).toEqual({
      universe: "dressing",
      focus: "tech",
    });
    expect(universeFor({ slug: "meubles", name: "Meubles", parent: achats })).toEqual({ universe: "dressing", focus: "lamp" });
    expect(universeFor({ slug: "anniversaires", name: "Anniversaires", parent: achats })).toEqual({
      universe: "dressing",
      focus: "gifts",
    });
  });

  it("opens a lone root part of the dressing room on unambiguous words only", () => {
    expect(universeFor({ slug: "vetements", name: "Vêtements", parent: null })).toEqual({
      universe: "dressing",
      focus: "wardrobe",
    });
    expect(universeFor({ slug: "high-tech", name: "High-tech", parent: null })).toEqual({ universe: "dressing", focus: "tech" });
    expect(universeFor({ slug: "cadeaux", name: "Cadeaux", parent: null })).toEqual({ universe: "dressing", focus: "gifts" });
    expect(universeFor({ slug: "shopping", name: "Shopping", parent: null })).toEqual({ universe: "dressing", focus: null });
    // Sports kit, a car's, a home's: no guess.
    expect(universeFor({ slug: "equipement", name: "Équipement", parent: null })).toBeNull();
    // Food bought is the kitchen's business, never the dressing room's.
    expect(universeFor({ slug: "achats-alimentaires", name: "Achats alimentaires", parent: null })).toBeNull();
  });
});

describe("universeFor — the study", () => {
  const impots = { slug: "impots", name: "Impôts et taxes" };

  it("opens the study on the seeded Impôts family", () => {
    expect(universeFor({ ...impots, parent: null })).toEqual({ universe: "study", focus: null });
  });

  it("puts each seeded child where its papers are", () => {
    const cases: Array<[string, string, string]> = [
      ["impots-revenu", "Impôt sur le revenu", "hourglass"],
      ["impots-fonciere", "Taxe foncière", "cadastre"],
      ["impots-habitation", "Taxe d'habitation", "tray"],
      ["impots-autres", "Autres prélèvements", "calculator"],
    ];
    for (const [slug, name, part] of cases) {
      expect(universeFor({ slug, name, parent: impots })).toEqual({ universe: "study", focus: part });
    }
  });

  it("places the household's own names under Impôts", () => {
    expect(universeFor({ slug: "solde-ir", name: "Solde IR", parent: impots })).toEqual({ universe: "study", focus: "hourglass" });
    expect(universeFor({ slug: "amendes", name: "Amendes", parent: impots })).toEqual({ universe: "study", focus: "calculator" });
    expect(universeFor({ slug: "redevance", name: "Redevance", parent: impots })).toEqual({ universe: "study", focus: "tray" });
  });

  it("opens a lone root part of the study rather than the whole family", () => {
    expect(universeFor({ slug: "taxe-fonciere", name: "Taxe foncière", parent: null })).toEqual({
      universe: "study",
      focus: "cadastre",
    });
    expect(universeFor({ slug: "ir", name: "Impôt sur le revenu", parent: null })).toEqual({
      universe: "study",
      focus: "hourglass",
    });
    expect(universeFor({ slug: "th", name: "Taxe d’habitation", parent: null })).toEqual({ universe: "study", focus: "tray" });
    expect(universeFor({ slug: "impots", name: "Impôts", parent: null })).toEqual({ universe: "study", focus: null });
    // Any direct debit at all: no guess.
    expect(universeFor({ slug: "prelevements", name: "Prélèvements", parent: null })).toBeNull();
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
