"""What owning the thing costs, on top of buying it.

Design §6.3 item 3: "Coût total de possession, pas seulement le prix d'achat.
Pour un véhicule : assurance, entretien, carburant, décote, projetés sur cinq
ans. Les postes sont préremplis par des moyennes françaises et ajustables."

Two kinds of cost, and the distinction is not cosmetic:

* **flat monthly** -- insurance, fuel, service charges. Constant in euros;
* **proportional to the asset's remaining value** -- maintenance, taxe
  foncière. Charged each year on the value at the START of that year, which is
  what makes an eight-year-old car cheaper to maintain in this model than a new
  one. Charging them on the purchase price for ever would overstate the cost of
  every ageing asset.

**Depreciation is declining balance, never straight line.** At 15 %/year a car
does not lose the same euros every year, and a straight line puts the residual
value at zero after seven years -- a figure the model would then feed into the
feasibility impact. Because each year's loss is a fraction of what is STILL
there, `depreciation_cents + residual_value_cents == price_cents` exactly, to
the cent, on every input: nothing is solved for or reconciled after the fact,
it falls out of the loop subtracting from the same running `value` it reads.

**The defaults are French averages, and they are defaults.** Every one is
overridable by the user, and every screen that uses them prints the assumption
beside the result, as design §10 requires. `"other"` deliberately has NO
prefilled items: inventing a fuel budget for a sofa would be a fabricated
figure wearing a French average's clothes.

**`CostItem` carries exactly one of its two amounts.** Both set, or neither,
raises rather than silently preferring one -- a cost nobody chose an amount
for is not a French average, it is a guess this engine refuses to make.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.engines.amortization import cents

# Design §6.3: "projetés sur cinq ans".
DEFAULT_OWNERSHIP_YEARS = 5
MAX_OWNERSHIP_YEARS = 30

_BPS = Decimal(10_000)


@dataclass(frozen=True)
class CostItem:
    """One running cost. Exactly one of the two amounts is set; both, or
    neither, raises rather than silently picking one."""

    key: str
    # French. Printed verbatim by the screen.
    label: str
    monthly_cents: int | None
    annual_bps_of_value: int | None


@dataclass(frozen=True)
class CostLine:
    key: str
    label: str
    total_cents: int
    monthly_average_cents: int


@dataclass(frozen=True)
class OwnershipReport:
    price_cents: int
    years: int
    lines: list[CostLine]
    depreciation_cents: int
    residual_value_cents: int
    # Every running cost, together. Depreciation is NOT in here -- it is not
    # money leaving the household's account, it is value leaving the asset, and
    # a screen that adds them without saying so is comparing two different
    # things. `total_cost_cents` is the sum a buyer should actually weigh.
    running_cost_cents: int
    total_cost_cents: int
    monthly_average_cents: int


# Moyennes françaises, ordres de grandeur 2025-2026, ajustables par
# l'utilisateur. Insurance: a mid-range comprehensive motor policy. Maintenance
# and fuel: a household driving roughly 12 000 km a year. These are prefilled
# starting points, not measurements, and every screen says so.
VEHICLE_DEFAULTS: tuple[CostItem, ...] = (
    CostItem("insurance", "Assurance", monthly_cents=6_500, annual_bps_of_value=None),
    CostItem("maintenance", "Entretien et réparations", monthly_cents=7_000,
             annual_bps_of_value=None),
    CostItem("fuel", "Carburant", monthly_cents=13_000, annual_bps_of_value=None),
)
# A car loses roughly 15 % of its remaining value a year.
VEHICLE_DEPRECIATION_BPS_PER_YEAR = 1500

PROPERTY_DEFAULTS: tuple[CostItem, ...] = (
    CostItem("property_tax", "Taxe foncière", monthly_cents=None, annual_bps_of_value=90),
    CostItem("charges", "Charges de copropriété", monthly_cents=15_000,
             annual_bps_of_value=None),
    CostItem("home_insurance", "Assurance habitation", monthly_cents=2_500,
             annual_bps_of_value=None),
    CostItem("upkeep", "Entretien", monthly_cents=None, annual_bps_of_value=100),
)
# Property is not assumed to lose value. Appreciation is a separate, explicit
# assumption made in `engines/property.py`, where it is displayed and editable
# -- baking a market view into a cost engine would hide it.
PROPERTY_DEPRECIATION_BPS_PER_YEAR = 0

# Everything below is a purchase a household saves for, and none of them is a
# car or a flat. A screen that offers only those two forces every other
# question -- a laptop, a kitchen, a wedding, a year of training -- through a
# nature called "Autre" that prefills nothing and names nothing.
#
# NONE of them prefills a running cost, and that is the same refusal
# `"other"` has always made: the electricity a computer draws, the insurance on
# a sofa, the spending money on a trip are not figures anyone can average
# honestly. What they DO carry is a depreciation rate and a holding period,
# because those are real, documented properties of the thing itself.

# Consumer electronics lose value faster than anything else a household buys.
# A phone or a laptop is worth roughly a third less each year on the
# second-hand market.
TECH_DEPRECIATION_BPS_PER_YEAR = 3500
# Furniture and white goods: slow, and they are kept a long time.
FURNITURE_DEPRECIATION_BPS_PER_YEAR = 1500
# A trip, a wedding, a year of training. There is no asset at the end and no
# resale value, so the whole price is consumed -- 100 % over the first year,
# which is exactly what the declining balance gives.
CONSUMED_DEPRECIATION_BPS_PER_YEAR = 10_000


@dataclass(frozen=True)
class NatureProfile:
    """One kind of purchase, and everything a screen needs to offer it.

    The French label lives here rather than in the front end for the same
    reason the cost items do: a nature added to the engine and not to the
    screen is a nature nobody can choose, and a label in two places drifts.
    """

    key: str
    label: str
    # One sentence, French, saying what this nature assumes and what it
    # deliberately does not. Printed beside the choice, so the reader picks
    # knowing what they are getting.
    note: str
    items: tuple[CostItem, ...]
    depreciation_bps_per_year: int
    # How long the household is assumed to keep it. Five years for a car or a
    # flat; three for a laptop, which is dead by then; one for a trip, which is
    # over. Editable, like every other assumption.
    ownership_years: int


NATURE_PROFILES: tuple[NatureProfile, ...] = (
    NatureProfile(
        key="vehicle",
        label="Véhicule",
        note=(
            "Assurance, entretien et carburant préremplis par des moyennes "
            "françaises, pour un foyer roulant environ 12 000 km par an. Décote "
            "de 15 % par an."
        ),
        items=VEHICLE_DEFAULTS,
        depreciation_bps_per_year=VEHICLE_DEPRECIATION_BPS_PER_YEAR,
        ownership_years=DEFAULT_OWNERSHIP_YEARS,
    ),
    NatureProfile(
        key="property",
        label="Immobilier",
        note=(
            "Taxe foncière, charges, assurance et entretien préremplis. Aucune "
            "décote : la revalorisation d'un bien est une hypothèse à part, "
            "affichée et modifiable dans le simulateur immobilier."
        ),
        items=PROPERTY_DEFAULTS,
        depreciation_bps_per_year=PROPERTY_DEPRECIATION_BPS_PER_YEAR,
        ownership_years=DEFAULT_OWNERSHIP_YEARS,
    ),
    NatureProfile(
        key="tech",
        label="High-tech et équipement",
        note=(
            "Ordinateur, téléphone, appareil photo, vélo électrique. Décote de "
            "35 % par an sur trois ans. Aucun coût d'usage prérempli : le vôtre "
            "dépend de ce que vous en faites, et une moyenne inventée serait un "
            "chiffre sans source."
        ),
        items=(),
        depreciation_bps_per_year=TECH_DEPRECIATION_BPS_PER_YEAR,
        ownership_years=3,
    ),
    NatureProfile(
        key="furniture",
        label="Mobilier et électroménager",
        note=(
            "Canapé, cuisine, lave-linge. Décote de 15 % par an sur dix ans. "
            "Aucun coût d'usage prérempli."
        ),
        items=(),
        depreciation_bps_per_year=FURNITURE_DEPRECIATION_BPS_PER_YEAR,
        ownership_years=10,
    ),
    NatureProfile(
        key="leisure",
        label="Voyage, loisirs, événement",
        note=(
            "Un voyage ou un mariage n'a pas de valeur de revente : le prix est "
            "intégralement consommé. Il n'y a donc ni coût de possession ni "
            "valeur résiduelle, seulement la somme à réunir."
        ),
        items=(),
        depreciation_bps_per_year=CONSUMED_DEPRECIATION_BPS_PER_YEAR,
        ownership_years=1,
    ),
    NatureProfile(
        key="education",
        label="Formation et études",
        note=(
            "Une formation ne se revend pas : le prix est intégralement "
            "consommé. Ce que vous en retirez ensuite n'est pas un chiffre que "
            "Yieldo peut mesurer, et il ne prétendra pas le faire."
        ),
        items=(),
        depreciation_bps_per_year=CONSUMED_DEPRECIATION_BPS_PER_YEAR,
        ownership_years=1,
    ),
    NatureProfile(
        key="other",
        label="Autre",
        note=(
            "Rien n'est prérempli et rien n'est supposé : ni coût d'usage, ni "
            "décote. Ajoutez vous-même les postes que vous connaissez."
        ),
        items=(),
        depreciation_bps_per_year=0,
        ownership_years=DEFAULT_OWNERSHIP_YEARS,
    ),
)

_BY_KEY: dict[str, NatureProfile] = {profile.key: profile for profile in NATURE_PROFILES}


def profile_for(nature: str) -> NatureProfile:
    """The whole profile for a nature. Raises on an unknown one rather than
    handing back a silent empty default that would read as "nothing to pay"."""
    try:
        return _BY_KEY[nature]
    except KeyError:
        raise ValueError(f"Nature d'achat inconnue : {nature}") from None


def defaults_for(nature: str) -> tuple[tuple[CostItem, ...], int]:
    """The prefilled items and depreciation rate for a purchase's nature.

    Four of the seven natures return no items at all, on purpose. See
    `NATURE_PROFILES` and the module docstring: inventing a fuel budget for a
    sofa would be a fabricated figure wearing a French average's clothes.
    """
    profile = profile_for(nature)
    return profile.items, profile.depreciation_bps_per_year


def _validate(
    price_cents: int, years: int, items: list[CostItem], depreciation_bps_per_year: int
) -> None:
    if price_cents < 0:
        raise ValueError("Le prix d'achat ne peut pas être négatif.")
    if not 1 <= years <= MAX_OWNERSHIP_YEARS:
        raise ValueError(
            f"La durée de possession doit être comprise entre 1 et {MAX_OWNERSHIP_YEARS} ans."
        )
    if not 0 <= depreciation_bps_per_year <= 10_000:
        # Capped at 10 000 (100 %/an) on the low AND high end: below zero would
        # model the asset APPRECIATING, which is the appreciation assumption
        # `engines/property.py` makes explicitly and this engine deliberately
        # does not; above it, the loss would exceed what is left, and the
        # residual value the household reads on screen would go negative.
        raise ValueError(
            "Le taux de décote annuel doit être compris entre 0 et 10 000 "
            "points de base (100 %)."
        )
    for item in items:
        if (item.monthly_cents is None) == (item.annual_bps_of_value is None):
            raise ValueError(
                f"Le poste « {item.label} » doit être défini soit par un montant "
                "mensuel, soit par un pourcentage annuel de la valeur du bien, "
                "mais pas les deux."
            )


def total_cost_of_ownership(
    price_cents: int, years: int, items: list[CostItem], depreciation_bps_per_year: int
) -> OwnershipReport:
    """Every running cost plus the decline in value, over `years` years.

    Depreciation compounds on the remaining value, never on `price_cents`: see
    the module docstring. Every `CostItem` is evaluated the same way -- flat
    ones add a constant per year, value-proportional ones read the value AT THE
    START of that year, before that year's own depreciation is applied.
    """
    _validate(price_cents, years, items, depreciation_bps_per_year)

    totals: dict[str, int] = {item.key: 0 for item in items}
    value = price_cents
    depreciation = 0

    for _year in range(years):
        for item in items:
            if item.monthly_cents is not None:
                totals[item.key] += item.monthly_cents * 12
            else:
                # On the value at the START of the year -- see the docstring.
                totals[item.key] += cents(
                    Decimal(value) * Decimal(item.annual_bps_of_value) / _BPS
                )
        loss = cents(Decimal(value) * Decimal(depreciation_bps_per_year) / _BPS)
        depreciation += loss
        value -= loss

    months = years * 12
    lines = [
        CostLine(key=item.key, label=item.label, total_cents=totals[item.key],
                 monthly_average_cents=cents(Decimal(totals[item.key]) / Decimal(months)))
        for item in items
    ]
    running = sum(line.total_cents for line in lines)
    total = running + depreciation
    return OwnershipReport(
        price_cents=price_cents, years=years, lines=lines,
        depreciation_cents=depreciation, residual_value_cents=value,
        running_cost_cents=running, total_cost_cents=total,
        monthly_average_cents=cents(Decimal(total) / Decimal(months)),
    )
