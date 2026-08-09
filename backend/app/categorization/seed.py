from sqlalchemy.orm import Session

from app.models import Category
from app.models.rule import CategoryRule

# (slug, name, kind, color, icon, [(child_slug, child_name), ...])
CATEGORY_TREE: list[tuple[str, str, str, str, str, list[tuple[str, str]]]] = [
    ("logement", "Logement", "expense", "#8ab4f8", "home", [
        ("logement-loyer", "Loyer"),
        ("logement-credit", "Crédit immobilier"),
        ("logement-charges", "Charges et copropriété"),
        ("logement-energie", "Énergie"),
        ("logement-internet", "Internet et téléphone"),
        ("logement-assurance", "Assurance habitation"),
        ("logement-travaux", "Travaux et entretien"),
    ]),
    ("alimentation", "Alimentation", "expense", "#4fd6a8", "shopping-cart", [
        ("alimentation-courses", "Courses"),
        ("alimentation-restaurant", "Restaurants"),
        ("alimentation-livraison", "Livraison"),
        ("alimentation-cafe", "Cafés et bars"),
    ]),
    ("transport", "Transport", "expense", "#f4a261", "car", [
        ("transport-carburant", "Carburant"),
        ("transport-entretien", "Entretien véhicule"),
        ("transport-assurance", "Assurance véhicule"),
        ("transport-peage", "Péage et stationnement"),
        ("transport-commun", "Transports en commun"),
        ("transport-voyage", "Billets et voyages"),
    ]),
    ("sante", "Santé", "expense", "#e5606b", "heart", [
        ("sante-medecin", "Consultations"),
        ("sante-pharmacie", "Pharmacie"),
        ("sante-mutuelle", "Mutuelle"),
        ("sante-optique", "Optique et dentaire"),
    ]),
    ("loisirs", "Loisirs", "expense", "#a78bfa", "sparkles", [
        ("loisirs-sorties", "Sorties et culture"),
        ("loisirs-sport", "Sport"),
        ("loisirs-vacances", "Vacances"),
        ("loisirs-hobbies", "Loisirs et hobbies"),
    ]),
    ("abonnements", "Abonnements", "expense", "#7ee2d6", "repeat", [
        ("abonnements-streaming", "Streaming"),
        ("abonnements-logiciels", "Logiciels et services"),
        ("abonnements-presse", "Presse"),
        ("abonnements-salle", "Salle de sport"),
    ]),
    ("achats", "Achats", "expense", "#fb7185", "bag", [
        ("achats-vetements", "Vêtements"),
        ("achats-equipement", "Équipement et high-tech"),
        ("achats-maison", "Maison et décoration"),
        ("achats-cadeaux", "Cadeaux"),
    ]),
    ("famille", "Famille", "expense", "#f472b6", "users", [
        ("famille-garde", "Garde d'enfants"),
        ("famille-scolarite", "Scolarité"),
        ("famille-animaux", "Animaux"),
    ]),
    ("impots", "Impôts et taxes", "expense", "#94a3b8", "receipt", [
        ("impots-revenu", "Impôt sur le revenu"),
        ("impots-fonciere", "Taxe foncière"),
        ("impots-habitation", "Taxe d'habitation"),
        ("impots-autres", "Autres prélèvements"),
    ]),
    ("frais", "Frais bancaires", "expense", "#64748b", "bank", [
        ("frais-tenue", "Frais de tenue de compte"),
        ("frais-agios", "Agios et incidents"),
        ("frais-carte", "Cotisation carte"),
    ]),
    ("divers", "Divers", "expense", "#64748b", "dots", []),
    ("revenus", "Revenus", "income", "#4fd6a8", "trending-up", [
        ("revenus-salaire", "Salaire"),
        ("revenus-primes", "Primes"),
        ("revenus-freelance", "Activité indépendante"),
        ("revenus-allocations", "Allocations et aides"),
        ("revenus-loyers", "Loyers perçus"),
        ("revenus-placements", "Revenus de placements"),
        ("revenus-remboursements", "Remboursements"),
        ("revenus-autres", "Autres revenus"),
    ]),
    ("epargne", "Épargne et investissement", "transfer", "#3b82f6", "piggy-bank", [
        ("epargne-livret", "Versement livret"),
        ("epargne-bourse", "Versement titres"),
        ("epargne-assurance-vie", "Versement assurance-vie"),
        ("epargne-per", "Versement PER"),
    ]),
    ("virement-interne", "Virement interne", "transfer", "#64748b", "arrows", []),
]


def seed_categories(db: Session, user_id: int) -> dict[str, Category]:
    """Create the default French category tree for a user. Safe to call twice."""
    existing = {c.slug: c for c in db.query(Category).filter(Category.user_id == user_id).all()}
    index: dict[str, Category] = dict(existing)

    for position, (slug, name, kind, color, icon, children) in enumerate(CATEGORY_TREE):
        parent = index.get(slug)
        if parent is None:
            parent = Category(user_id=user_id, name=name, slug=slug, kind=kind,
                              color=color, icon=icon, position=position)
            db.add(parent)
            db.flush()
            index[slug] = parent

        for child_position, (child_slug, child_name) in enumerate(children):
            if child_slug in index:
                continue
            child = Category(user_id=user_id, parent_id=parent.id, name=child_name,
                             slug=child_slug, kind=kind, color=color, icon=icon,
                             position=child_position)
            db.add(child)
            db.flush()
            index[child_slug] = child

    db.commit()
    return index


# (category slug, direction, [patterns])
BUILTIN_RULES: list[tuple[str, str, list[str]]] = [
    ("alimentation-courses", "debit", [
        "carrefour", "leclerc", "intermarche", "auchan", "lidl", "aldi", "monoprix",
        "franprix", "casino", "super u", "hyper u", "cora", "grand frais", "picard",
        "biocoop", "naturalia", "g20", "spar", "netto", "match", "colruyt",
    ]),
    ("alimentation-restaurant", "debit", [
        "restaurant", "brasserie", "pizzeria", "mcdonald", "burger king", "kfc",
        "subway", "quick", "sushi", "bistrot", "creperie", "traiteur",
    ]),
    ("alimentation-livraison", "debit", [
        "uber eats", "deliveroo", "just eat", "frichti",
    ]),
    ("alimentation-cafe", "debit", ["starbucks", "columbus cafe", "bar tabac"]),
    ("logement-loyer", "debit", ["loyer", "quittance"]),
    ("logement-energie", "debit", [
        # One word, no space: normalize_label strips punctuation but never inserts
        # separators, so the brand arrives as "totalenergies". Written with a space
        # this pattern can never match, and gas bills fall through to the fuel rule.
        # Longer pattern wins at equal priority, so this beats plain "totalenergies".
        "edf", "engie", "totalenergies gaz", "eni gas", "veolia", "suez",
        "saur", "primeo energie", "vattenfall",
    ]),
    ("logement-internet", "debit", [
        "free mobile", "free haut debit", "orange", "sfr", "bouygues telecom",
        "sosh", "red by sfr", "bouygues",
    ]),
    ("logement-assurance", "debit", [
        "maif", "macif", "matmut", "gmf", "axa habitation", "allianz habitation",
    ]),
    ("logement-charges", "debit", ["syndic", "copropriete", "charges locatives"]),
    ("transport-carburant", "debit", [
        "totalenergies", "total access", "esso", "bp france", "shell", "avia",
        "station service", "carrefour station",
    ]),
    ("transport-peage", "debit", [
        "vinci autoroutes", "sanef", "aprr", "escota", "cofiroute", "peage",
        "parking", "indigo park", "effia",
    ]),
    ("transport-commun", "debit", [
        "ratp", "navigo", "tcl", "tisseo", "transpole", "keolis", "bibus",
    ]),
    ("transport-voyage", "debit", [
        "sncf", "ouigo", "trainline", "blablacar", "flixbus", "air france",
        "easyjet", "ryanair", "transavia", "booking com", "airbnb",
    ]),
    ("transport-entretien", "debit", [
        "norauto", "feu vert", "midas", "speedy", "euromaster", "controle technique",
    ]),
    ("transport-assurance", "debit", ["assurance auto", "direct assurance"]),
    ("sante-pharmacie", "debit", ["pharmacie", "parapharmacie"]),
    ("sante-medecin", "debit", [
        "cabinet medical", "docteur", "dr ", "laboratoire", "biogroup", "cerballiance",
        "kinesitherapeute", "hopital", "clinique",
    ]),
    ("sante-mutuelle", "debit", [
        "mutuelle", "harmonie mutuelle", "malakoff", "alan sante", "mgen",
    ]),
    ("sante-optique", "debit", ["optic", "krys", "afflelou", "grand optical", "dentaire"]),
    ("abonnements-streaming", "debit", [
        "netflix", "spotify", "deezer", "disney plus", "canal", "prime video",
        "apple tv", "youtube premium", "max com",
    ]),
    ("abonnements-logiciels", "debit", [
        "google one", "google storage", "icloud", "dropbox", "adobe", "microsoft 365",
        "openai", "anthropic", "github", "notion", "figma",
    ]),
    ("abonnements-salle", "debit", [
        "basic fit", "fitness park", "keep cool", "neoness", "on air",
    ]),
    ("abonnements-presse", "debit", ["le monde", "mediapart", "telerama", "les echos"]),
    ("achats-equipement", "debit", [
        "fnac", "darty", "boulanger", "ldlc", "materiel net", "apple store",
        "cdiscount", "back market",
    ]),
    ("achats-vetements", "debit", [
        "zara", "h m", "uniqlo", "decathlon", "kiabi", "celio", "jules",
        "vinted", "zalando", "asos",
    ]),
    ("achats-maison", "debit", [
        "ikea", "leroy merlin", "castorama", "bricorama", "maisons du monde",
        "conforama", "but ",
    ]),
    ("achats-cadeaux", "debit", ["amazon", "etsy", "aliexpress", "temu"]),
    ("famille-animaux", "debit", ["veterinaire", "maxi zoo", "animalis"]),
    ("impots-revenu", "debit", ["dgfip impot", "impots gouv", "prelevement a la source"]),
    ("impots-fonciere", "debit", ["taxe fonciere"]),
    ("impots-habitation", "debit", ["taxe habitation", "redevance audiovisuel"]),
    ("frais-tenue", "debit", ["frais tenue de compte", "cotisation compte"]),
    ("frais-agios", "debit", ["agios", "commission intervention", "frais incident"]),
    ("frais-carte", "debit", ["cotisation carte", "cotisation visa", "cotisation mastercard"]),
    ("epargne-livret", "any", ["vir livret", "versement livret", "livret a"]),
    ("epargne-bourse", "any", ["trade republic", "boursorama pea", "degiro", "saxo"]),
    ("epargne-assurance-vie", "any", ["linxea", "assurance vie", "spirica", "suravenir"]),
    ("revenus-salaire", "credit", ["salaire", "paie", "remuneration", "vir sepa employeur"]),
    ("revenus-allocations", "credit", ["caf ", "pole emploi", "france travail", "apl"]),
    ("revenus-remboursements", "credit", [
        "cpam", "ameli", "remboursement", "secu", "assurance maladie",
    ]),
    ("revenus-loyers", "credit", ["loyer percu", "vir locataire"]),
    ("virement-interne", "any", ["virement interne", "vir compte a compte"]),
]


def seed_rules(db: Session, user_id: int, categories: dict[str, Category]) -> int:
    """Install the built-in French rule library. Returns how many rules were created."""
    existing = {
        (r.pattern, r.category_id)
        for r in db.query(CategoryRule).filter(CategoryRule.user_id == user_id).all()
    }
    created = 0
    for slug, direction, patterns in BUILTIN_RULES:
        category = categories.get(slug)
        if category is None:
            continue
        for pattern in patterns:
            if (pattern, category.id) in existing:
                continue
            db.add(CategoryRule(
                user_id=user_id, pattern=pattern, is_regex=False,
                category_id=category.id, priority=100, origin="builtin",
                direction=direction,
            ))
            created += 1
    db.commit()
    return created
