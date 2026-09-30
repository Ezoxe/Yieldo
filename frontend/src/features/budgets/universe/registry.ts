/**
 * Which universe a category lives in, and which part of it the category is.
 *
 * A universe is a FAMILY: the car is Transport, and Carburant, Entretien,
 * Assurance and Péage are its parts. So a category is matched in this order:
 *
 * 1. a child is read through its parent — if the parent is a universe, the
 *    child is that universe with its own part in front. A child the universe
 *    has no part for (« Transports en commun » in the car) gets no scene: it
 *    keeps its page and its figures, and a wrong-but-confident drawing is
 *    worse than none;
 * 2. a category that IS a universe (the seeded `transport`, or a name such as
 *    « Voiture ») opens it with no part in front;
 * 3. a ROOT category that is recognisably one part (« Essence » created on
 *    its own) opens that part's universe — on unambiguous words only.
 *    « Assurance » or « Entretien » alone could be the house or the car, and
 *    guessing the car for a home insurance is the wrong-but-confident case.
 *
 * Seeded slugs are tried before words: they are stable, names are the
 * household's to change.
 */

export type UniverseId = "car" | "house";
export type CarPart = "fuel" | "engine" | "cage" | "toll";
export type HousePart = "roof" | "door" | "net" | "power" | "water" | "workshop";
export type PartId = CarPart | HousePart;

export interface Named {
  slug: string;
  name: string;
}

export interface UniverseMatch {
  universe: UniverseId;
  /** The part put in front; null when the page is the whole family. */
  focus: PartId | null;
}

interface PartRule {
  id: PartId;
  slugs: readonly string[];
  /** Enough to place a child of the universe. */
  words: RegExp;
  /** Enough to place a root category with no family: never an ambiguous word. */
  strong: RegExp | null;
}

interface UniverseRule {
  id: UniverseId;
  slugs: readonly string[];
  words: RegExp;
  parts: readonly PartRule[];
}

const CAR: UniverseRule = {
  id: "car",
  slugs: ["transport"],
  words: /\b(voitures?|autos?|automobiles?|véhicules?|vehicules?|motos?)\b/i,
  parts: [
    {
      id: "fuel",
      slugs: ["transport-carburant"],
      words: /carburant|essence|gazole|diesel|plein|recharge|borne/i,
      strong: /carburant|essence|gazole|diesel/i,
    },
    {
      id: "engine",
      slugs: ["transport-entretien"],
      words: /entretien|garage|révision|revision|pneu|réparation|reparation|contr[ôo]le technique/i,
      strong: /garage|pneu|contr[ôo]le technique/i,
    },
    {
      id: "cage",
      slugs: ["transport-assurance"],
      words: /assurance/i,
      strong: null,
    },
    {
      id: "toll",
      slugs: ["transport-peage"],
      words: /péage|peage|parking|stationnement|autoroute/i,
      strong: /péage|peage|autoroute/i,
    },
  ],
};

/**
 * The Logement family as a traditional house. The rent and the mortgage are
 * the same thing to it — the key in the door — and when a household has both,
 * the one it actually pays is drawn (see `readings.partReadings`).
 */
const HOUSE: UniverseRule = {
  id: "house",
  slugs: ["logement"],
  words: /\b(logements?|maisons?|appartements?|domicile)\b/i,
  parts: [
    {
      id: "door",
      slugs: ["logement-loyer", "logement-credit"],
      words: /loyer|cr[ée]dit immobilier|pr[êe]t immobilier|hypoth/i,
      strong: /loyer|cr[ée]dit immobilier|pr[êe]t immobilier/i,
    },
    {
      id: "power",
      slugs: ["logement-energie"],
      words: /[ée]nergie|[ée]lectricit[ée]|\bgaz\b|chauffage|fioul|\bedf\b/i,
      strong: /[ée]lectricit[ée]|chauffage|fioul/i,
    },
    {
      id: "net",
      slugs: ["logement-internet"],
      words: /internet|t[ée]l[ée]phone|\bbox\b|mobile|forfait|fibre/i,
      strong: /internet|t[ée]l[ée]phone|forfait|fibre/i,
    },
    {
      id: "roof",
      slugs: ["logement-assurance"],
      words: /assurance/i,
      strong: /assurance habitation|multirisque/i,
    },
    {
      id: "water",
      slugs: ["logement-charges"],
      words: /charges|copropri[ée]t[ée]|syndic|\beau\b/i,
      strong: /copropri[ée]t[ée]|syndic/i,
    },
    {
      id: "workshop",
      slugs: ["logement-travaux"],
      words: /travaux|entretien|bricolage|jardin|r[ée]paration/i,
      strong: /travaux|bricolage/i,
    },
  ],
};

const UNIVERSES: readonly UniverseRule[] = [CAR, HOUSE];

function isUniverse(rule: UniverseRule, category: Named): boolean {
  return rule.slugs.includes(category.slug) || rule.words.test(category.name);
}

function partOf(rule: UniverseRule, category: Named): PartId | null {
  const bySlug = rule.parts.find((part) => part.slugs.includes(category.slug));
  if (bySlug) return bySlug.id;
  return rule.parts.find((part) => part.words.test(category.name))?.id ?? null;
}

/** The part `category` plays in `universe`, or null when it plays none. */
export function partFor(universe: UniverseId, category: Named): PartId | null {
  const rule = UNIVERSES.find((candidate) => candidate.id === universe);
  return rule ? partOf(rule, category) : null;
}

export function universeFor(category: Named & { parent: Named | null }): UniverseMatch | null {
  const { parent } = category;
  if (parent !== null) {
    const family = UNIVERSES.find((rule) => isUniverse(rule, parent));
    if (family) {
      const focus = partOf(family, category);
      return focus === null ? null : { universe: family.id, focus };
    }
  }

  const own = UNIVERSES.find((rule) => isUniverse(rule, category));
  if (own) return { universe: own.id, focus: null };

  if (parent === null) {
    for (const rule of UNIVERSES) {
      const part = rule.parts.find(
        (candidate) =>
          candidate.slugs.includes(category.slug) || (candidate.strong?.test(category.name) ?? false),
      );
      if (part) return { universe: rule.id, focus: part.id };
    }
  }
  return null;
}
