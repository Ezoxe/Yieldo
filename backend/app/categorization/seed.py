from sqlalchemy.orm import Session

from app.models import Category

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
