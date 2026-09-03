"""Building the filterable context export. Design §8.2.

`build_context_export` turns a household's own data plus a declared scope into
one structured Markdown document a language model can read, together with an
estimate of what it will cost in tokens and a warning when it will not fit the
window of the model it is destined for.

**The scope is the feature.** Design §8.2's own example -- "« Dépenses 2025 et
2026 seulement » exclut effectivement 2024" -- is the whole contract: every
dimension below (period, accounts, categories, granularity, modules) EXCLUDES
what it does not name, and `tests/test_context_export.py` proves each one
against a fixture where a broken filter would leak something visible into the
rendered document rather than merely change a total.

**Anonymisation is a promise about the whole document, not about one field.**
When it is on, no merchant string and no absolute amount survives anywhere in
the output -- not in a table, not in a heading, not inside a module's prose.
Every identifier the household or its bank wrote goes through `_Masker`, and
every monetary figure goes through the single `_amount` formatter, which under
anonymisation returns a share of a declared base and never a euro figure. The
currency itself is not printed either: naming it re-attaches the document to a
place and a bank.

Category names are the one deliberate exception, and it is stated inside the
document: they come from Yieldo's own taxonomy, describe a kind of spending
rather than a counterparty, and stripping them would leave a budget export
with nothing to reason about.

Pure: no session, no network, no implicit clock -- `today` is a parameter, and
it is used only to resolve a period with no bounds on a ledger with no rows.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.engines.aggregate import bucket_bounds, bucket_key
from app.engines.period import month_end, resolve_range

Granularity = Literal["annual", "monthly", "transaction"]

Module = Literal[
    "profil", "budget", "patrimoine", "dettes", "objectifs",
    "positions", "recurrences", "analyses", "projections", "fiscalite",
]

# Design §8.2's own list, in its own order. `analyses` is the module that
# carries the period tables, so `granularity` only has an effect when it is
# selected -- said in the document itself rather than left to be discovered.
MODULES: tuple[Module, ...] = (
    "profil", "budget", "patrimoine", "dettes", "objectifs",
    "positions", "recurrences", "analyses", "projections", "fiscalite",
)

MODULE_TITLES: dict[Module, str] = {
    "profil": "Profil",
    "budget": "Budget",
    "patrimoine": "Patrimoine",
    "dettes": "Dettes",
    "objectifs": "Objectifs",
    "positions": "Positions",
    "recurrences": "Récurrences",
    "analyses": "Analyses",
    "projections": "Projections",
    "fiscalite": "Fiscalité",
}

GRANULARITY_LABELS: dict[Granularity, str] = {
    "annual": "annuelle",
    "monthly": "mensuelle",
    "transaction": "transaction par transaction",
}


@dataclass(frozen=True)
class TargetModel:
    """A context window the operator declares, never one Yieldo discovers.

    Nothing here is fetched and nothing is probed: these are the sizes the
    reader picks from so the warning below can be computed at all. A window
    that moves is the operator's to correct, which is why `context_tokens` is
    a plain declared integer rather than something inferred from an endpoint.
    """

    key: str
    label: str
    context_tokens: int


TARGET_MODELS: tuple[TargetModel, ...] = (
    TargetModel("local-8k", "Modèle local, fenêtre de 8 000 tokens", 8_000),
    TargetModel("local-32k", "Modèle local, fenêtre de 32 000 tokens", 32_768),
    TargetModel("gpt-4o", "GPT-4o (128 000 tokens)", 128_000),
    TargetModel("claude-sonnet", "Claude Sonnet (200 000 tokens)", 200_000),
    TargetModel("gemini-1-5-pro", "Gemini 1.5 Pro (1 000 000 tokens)", 1_000_000),
)


def target_model(key: str) -> TargetModel:
    """The declared window for `key`, or a French refusal.

    Never a default: silently falling back to some other model's window would
    tell the reader a document fits a machine it was never measured against.
    """
    for model in TARGET_MODELS:
        if model.key == key:
            return model
    known = ", ".join(f"« {model.key} »" for model in TARGET_MODELS)
    raise ValueError(
        f"Modèle cible inconnu : « {key} ». Modèles déclarés : {known}."
    )


# Characters per token, times ten. Deliberately LOW (3,5 rather than the 4,0
# usually quoted for English): French accented text and euro figures tokenise
# worse than English prose, and the two directions of error are not
# symmetrical -- over-estimating warns about a document that would have fitted,
# under-estimating tells the reader a document fits a window it overflows.
_CHARS_PER_TOKEN_X10 = 35


def estimate_tokens(text: str) -> int:
    """An ESTIMATE, and named one everywhere it is shown.

    Yieldo tokenises nothing: every model has its own vocabulary, and shipping
    one tokeniser would make the figure exact for one model and wrong for the
    rest. Integer arithmetic, rounded up.
    """
    characters = len(text)
    return (characters * 10 + _CHARS_PER_TOKEN_X10 - 1) // _CHARS_PER_TOKEN_X10


# --------------------------------------------------------------------------
# Inputs. Every one is a plain frozen record the caller has already fetched;
# this module never queries anything.
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ExportTransaction:
    id: int
    on: date
    amount_cents: int
    label: str
    account_id: int
    account_name: str
    category_id: int | None
    category_name: str | None
    is_transfer: bool


@dataclass(frozen=True)
class ExportAccount:
    id: int
    name: str
    kind: str
    balance_cents: int


@dataclass(frozen=True)
class ExportDebt:
    name: str
    principal_cents: int
    annual_rate_bps: int
    minimum_payment_cents: int


@dataclass(frozen=True)
class ExportGoal:
    name: str
    target_cents: int
    saved_cents: int
    due_on: date | None


@dataclass(frozen=True)
class ExportPosition:
    symbol: str
    name: str
    asset_class: str
    # A quantity is NOT money: it travels as the canonical decimal string
    # `engines/quantity.py` produces, and never through a money formatter.
    quantity: str
    # None when the position could not be valued at all -- never 0, which is a
    # real (empty) holding.
    market_value_cents: int | None


@dataclass(frozen=True)
class ExportRecurrence:
    label: str
    amount_cents: int
    periodicity: str
    annual_cents: int
    status: str


@dataclass(frozen=True)
class ExportProjection:
    horizon_months: int
    annual_rate_bps: int
    monthly_contribution_cents: int
    initial_cents: int
    final_cents: int


@dataclass(frozen=True)
class ExportTax:
    regime_label: str
    gain_cents: int
    tax_cents: int


@dataclass(frozen=True)
class ExportInputs:
    """Everything the ten modules might need, already fetched by the caller.

    The two `*_unavailable_reason` fields exist for the same reason
    `/api/projection`'s do: a module whose engine could not answer prints that
    engine's own French sentence, never an empty section and never a zero.
    """

    reporting_currency: str
    transactions: list[ExportTransaction]
    accounts: list[ExportAccount]
    categories: dict[int, str]
    debts: list[ExportDebt]
    goals: list[ExportGoal]
    positions: list[ExportPosition]
    recurrences: list[ExportRecurrence]
    net_worth_cents: int | None
    projection: ExportProjection | None
    projection_unavailable_reason: str | None
    tax: ExportTax | None
    tax_unavailable_reason: str | None


@dataclass(frozen=True)
class ExportScope:
    """What the reader ticked. `None` on a set means "every one of them"; an
    EMPTY set means "none of them", and the two are deliberately different."""

    date_from: date | None
    date_to: date | None
    account_ids: frozenset[int] | None
    category_ids: frozenset[int] | None
    granularity: Granularity
    modules: tuple[Module, ...]
    anonymise: bool


@dataclass(frozen=True)
class ExportDocument:
    markdown: str
    estimated_tokens: int
    # None when no target model was named, or when the document fits it.
    warning: str | None
    transaction_count: int
    excluded_transfer_count: int
    date_from: date
    date_to: date
    sections: tuple[Module, ...]


# --------------------------------------------------------------------------
# The filter. This is the feature: each clause EXCLUDES what it does not name.
# --------------------------------------------------------------------------


def select_transactions(
    rows: list[ExportTransaction], scope: ExportScope, start: date, end: date
) -> tuple[list[ExportTransaction], int]:
    """The rows inside the scope, and how many internal transfers were dropped.

    Four independent exclusions, each provable on its own:

    * **period** -- `start <= on <= end`, inclusive at both ends.
    * **accounts** -- a row on an account the scope did not name is out.
    * **categories** -- a row in a category the scope did not name is out, and
      so is an UNCATEGORISED row: "no category" is not "every category", and a
      scope that named categories has not named it.
    * **transfers** -- an internal transfer is a movement, not a flow. It is
      never in an export, and the count of what was dropped is printed in the
      document so the reader can tell an exclusion from an absence.
    """
    kept: list[ExportTransaction] = []
    transfers = 0
    for row in rows:
        if not (start <= row.on <= end):
            continue
        if scope.account_ids is not None and row.account_id not in scope.account_ids:
            continue
        if scope.category_ids is not None and (
            row.category_id is None or row.category_id not in scope.category_ids
        ):
            continue
        if row.is_transfer:
            transfers += 1
            continue
        kept.append(row)
    kept.sort(key=lambda row: (row.on, row.id))
    return kept, transfers


# --------------------------------------------------------------------------
# Anonymisation.
# --------------------------------------------------------------------------


class _Masker:
    """Stable pseudonyms, one counter per KIND of identifier.

    Stability is the whole point: two rows carrying the same merchant must
    read as the same masked merchant, or every aggregation a model performs on
    the document is silently wrong. First-seen order, and the same string
    always maps to the same pseudonym for the life of one document.
    """

    def __init__(self) -> None:
        self._seen: dict[tuple[str, str], str] = {}
        self._counts: dict[str, int] = {}

    def mask(self, kind: str, value: str) -> str:
        key = (kind, value)
        if key not in self._seen:
            self._counts[kind] = self._counts.get(kind, 0) + 1
            self._seen[key] = f"{kind} {self._counts[kind]}"
        return self._seen[key]


@dataclass
class _Render:
    """Everything the renderers below need to turn a figure into a string.

    One object, threaded everywhere, so there is exactly ONE place that decides
    whether an amount is printed as euros or as a share -- a second formatter
    is how an absolute figure survives an anonymised export.
    """

    anonymise: bool
    currency: str
    base_cents: int
    masker: _Masker

    def amount(self, cents: int | None) -> str:
        if cents is None:
            return "non valorisé"
        if not self.anonymise:
            return _fmt_eur(cents, self.currency)
        return _fmt_share(cents, self.base_cents)

    def merchant(self, label: str) -> str:
        return self.masker.mask("Marchand", label) if self.anonymise else label

    def account(self, name: str) -> str:
        return self.masker.mask("Compte", name) if self.anonymise else name

    def goal(self, name: str) -> str:
        return self.masker.mask("Objectif", name) if self.anonymise else name

    def debt(self, name: str) -> str:
        return self.masker.mask("Dette", name) if self.anonymise else name

    def instrument(self, symbol: str, name: str) -> str:
        if self.anonymise:
            return self.masker.mask("Instrument", f"{symbol} {name}")
        return f"{symbol} — {name}"


# The symbol a currency is written with. A code this table does not know
# prints ITSELF -- "12,00 SEK" is honest; inventing a glyph is not.
_CURRENCY_SYMBOLS = {"EUR": "€", "USD": "$", "GBP": "£"}


def _fmt_eur(cents: int, currency: str) -> str:
    sign = "-" if cents < 0 else ""
    value = Decimal(abs(cents)) / 100
    body = f"{value:,.2f}".replace(",", " ").replace(".", ",")
    return f"{sign}{body} {_CURRENCY_SYMBOLS.get(currency, currency)}"


def _fmt_share(cents: int, base_cents: int) -> str:
    """A signed share of the document's declared base, to one decimal.

    `Decimal`, never a float: the base is a monetary magnitude and the
    quotient is what stands in for money everywhere in an anonymised document.
    """
    permille = (Decimal(cents) * 1000 / Decimal(base_cents)).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP
    )
    whole, tenth = divmod(abs(int(permille)), 10)
    sign = "-" if permille < 0 else ""
    return f"{sign}{whole},{tenth} %"


def _fmt_rate_bps(bps: int) -> str:
    sign = "-" if bps < 0 else ""
    absolute = abs(bps)
    return f"{sign}{absolute // 100},{absolute % 100:02d} %"


# French labels for the enumerated values the models store in English. An
# unknown key prints ITSELF rather than a made-up label: showing the raw value
# is honest, inventing a French name for something this table does not know is
# the "sentence naming the wrong cause" defect in miniature.
_KIND_FR = {
    "checking": "compte courant", "savings": "livret", "cash": "espèces",
    "credit_card": "carte de crédit", "cto": "compte-titres", "pea": "PEA",
    "assurance_vie": "assurance-vie", "per": "PER",
}
_PERIODICITY_FR = {
    "weekly": "hebdomadaire", "monthly": "mensuel", "quarterly": "trimestriel",
    "yearly": "annuel",
}
_STATUS_FR = {"active": "actif", "missing": "échéance manquée", "ended": "terminé"}
_ASSET_CLASS_FR = {
    "equity": "actions", "bond": "obligations", "etf": "ETF", "cash": "liquidités",
    "crypto": "crypto-actifs", "real_estate": "immobilier",
}


def _fr(table: dict[str, str], key: str) -> str:
    return table.get(key, key)


# --------------------------------------------------------------------------
# Section renderers. Each returns the lines of one `## ` section.
# --------------------------------------------------------------------------


def _period_rows(
    rows: list[ExportTransaction], granularity: Granularity
) -> list[tuple[str, int, int]]:
    """`(bucket, inflow, outflow)` per period, ordered. `bucket_key` is the
    same bucketing `engines/aggregate.py` uses everywhere else, so a period
    edge is never cut differently in two places."""
    buckets: dict[str, list[int]] = {}
    unit = "year" if granularity == "annual" else "month"
    for row in rows:
        key = bucket_key(row.on, unit)
        entry = buckets.setdefault(key, [0, 0])
        if row.amount_cents >= 0:
            entry[0] += row.amount_cents
        else:
            entry[1] += row.amount_cents
    return [(key, buckets[key][0], buckets[key][1]) for key in sorted(buckets)]


def _category_totals(rows: list[ExportTransaction]) -> list[tuple[str, int, int]]:
    """`(category, outflow, count)`, biggest spend first. An uncategorised row
    is its own line rather than folded into another category."""
    totals: dict[str, list[int]] = {}
    for row in rows:
        if row.amount_cents >= 0:
            continue
        name = row.category_name or "Sans catégorie"
        entry = totals.setdefault(name, [0, 0])
        entry[0] += row.amount_cents
        entry[1] += 1
    return sorted(
        ((name, value[0], value[1]) for name, value in totals.items()),
        key=lambda item: item[1],
    )


def _scoped_accounts(inputs: ExportInputs, scope: ExportScope) -> list[ExportAccount]:
    """The accounts the scope named. An account scope filters the ACCOUNT LIST
    as well as the rows: a document that excluded a joint account's
    transactions and then printed its name and its balance in the profile
    would have leaked exactly what the scope was drawn to exclude."""
    if scope.account_ids is None:
        return list(inputs.accounts)
    return [account for account in inputs.accounts if account.id in scope.account_ids]


def _section_profil(
    inputs: ExportInputs, scope: ExportScope, rows: list[ExportTransaction],
    render: _Render, start: date, end: date,
) -> list[str]:
    inflow = sum(row.amount_cents for row in rows if row.amount_cents > 0)
    outflow = sum(row.amount_cents for row in rows if row.amount_cents < 0)
    lines = [
        f"- Opérations retenues : {len(rows)}",
        f"- Du {start.isoformat()} au {end.isoformat()}",
        f"- Entrées : {render.amount(inflow)}",
        f"- Sorties : {render.amount(outflow)}",
        f"- Solde des flux : {render.amount(inflow + outflow)}",
        "",
        "| Compte | Type | Solde |",
        "| --- | --- | --- |",
    ]
    accounts = _scoped_accounts(inputs, scope)
    if not accounts:
        lines.append("| Aucun compte dans le périmètre | — | — |")
    for account in accounts:
        lines.append(
            f"| {render.account(account.name)} | {_fr(_KIND_FR, account.kind)} | "
            f"{render.amount(account.balance_cents)} |"
        )
    return lines


def _section_analyses(
    rows: list[ExportTransaction], scope: ExportScope, render: _Render
) -> list[str]:
    lines: list[str] = []
    if scope.granularity == "transaction":
        lines += [
            f"Les {len(rows)} opérations du périmètre, une par ligne.",
            "",
            "| Date | Compte | Catégorie | Libellé | Montant |",
            "| --- | --- | --- | --- | --- |",
        ]
        for row in rows:
            lines.append(
                f"| {row.on.isoformat()} | {render.account(row.account_name)} | "
                f"{row.category_name or 'Sans catégorie'} | {render.merchant(row.label)} | "
                f"{render.amount(row.amount_cents)} |"
            )
    else:
        unit = "année" if scope.granularity == "annual" else "mois"
        lines += [
            f"Agrégats par {unit}.",
            "",
            "| Période | Entrées | Sorties | Solde |",
            "| --- | --- | --- | --- |",
        ]
        for key, inflow, outflow in _period_rows(rows, scope.granularity):
            lines.append(
                f"| {key} | {render.amount(inflow)} | {render.amount(outflow)} | "
                f"{render.amount(inflow + outflow)} |"
            )

    totals = _category_totals(rows)
    lines += ["", "### Dépenses par catégorie", "", "| Catégorie | Dépense | Opérations |",
              "| --- | --- | --- |"]
    if not totals:
        lines.append("| Aucune dépense sur ce périmètre | — | 0 |")
    for name, outflow, count in totals:
        lines.append(f"| {name} | {render.amount(outflow)} | {count} |")
    return lines


def _section_budget(rows: list[ExportTransaction], render: _Render) -> list[str]:
    """The measured spend per category, which is what a budget question is
    actually about. No declared budget travels here: Yieldo stores budgets per
    month and per category, and re-deriving them from a scope that may span
    years would be a figure no engine produced."""
    totals = _category_totals(rows)
    if not totals:
        return ["Aucune dépense observée sur ce périmètre : il n'y a rien à budgéter."]
    heaviest = totals[0]
    return [
        f"Poste le plus lourd sur le périmètre : {heaviest[0]}, "
        f"{render.amount(heaviest[1])} sur {heaviest[2]} opérations.",
        f"Nombre de postes de dépense observés : {len(totals)}.",
    ]


def _section_patrimoine(
    inputs: ExportInputs, scope: ExportScope, render: _Render
) -> list[str]:
    lines: list[str] = []
    if scope.account_ids is not None:
        # The household's net worth spans every account, including the ones
        # this scope excluded. Printing it here would put back exactly the
        # figure the account filter was drawn to keep out, so it is withheld
        # and the withholding is stated.
        lines.append(
            "Patrimoine net non communiqué : il porte sur l'ensemble des comptes, "
            "or ce périmètre n'en retient qu'une partie. Retirez le filtre par "
            "compte pour l'obtenir."
        )
    elif inputs.net_worth_cents is None:
        lines.append(
            "Patrimoine net non calculable : aucun solde de compte n'est connu. "
            "Déclarez vos comptes pour que cette section ait un contenu."
        )
    else:
        lines.append(f"- Patrimoine net : {render.amount(inputs.net_worth_cents)}")

    accounts = _scoped_accounts(inputs, scope)
    if accounts:
        lines += ["", "| Compte | Type | Solde |", "| --- | --- | --- |"]
        for account in accounts:
            lines.append(
                f"| {render.account(account.name)} | {_fr(_KIND_FR, account.kind)} | "
                f"{render.amount(account.balance_cents)} |"
            )
    return lines


def _section_dettes(inputs: ExportInputs, render: _Render) -> list[str]:
    if not inputs.debts:
        return ["Aucune dette déclarée."]
    lines = ["| Dette | Capital restant | Taux | Mensualité minimale |",
             "| --- | --- | --- | --- |"]
    for debt in inputs.debts:
        lines.append(
            f"| {render.debt(debt.name)} | {render.amount(debt.principal_cents)} | "
            f"{_fmt_rate_bps(debt.annual_rate_bps)} | "
            f"{render.amount(debt.minimum_payment_cents)} |"
        )
    return lines


def _section_objectifs(inputs: ExportInputs, render: _Render) -> list[str]:
    if not inputs.goals:
        return ["Aucun objectif déclaré."]
    lines = ["| Objectif | Cible | Déjà mis de côté | Échéance |", "| --- | --- | --- | --- |"]
    for goal in inputs.goals:
        due = goal.due_on.isoformat() if goal.due_on is not None else "aucune"
        lines.append(
            f"| {render.goal(goal.name)} | {render.amount(goal.target_cents)} | "
            f"{render.amount(goal.saved_cents)} | {due} |"
        )
    return lines


def _section_positions(inputs: ExportInputs, render: _Render) -> list[str]:
    if not inputs.positions:
        return ["Aucune position déclarée."]
    # A quantity is not money and never goes through a money formatter -- and
    # under anonymisation it is dropped outright: a holding of 0,25 BTC
    # identifies a portfolio as surely as its value does.
    if render.anonymise:
        lines = ["| Instrument | Classe | Valorisation |", "| --- | --- | --- |"]
        for position in inputs.positions:
            lines.append(
                f"| {render.instrument(position.symbol, position.name)} | "
                f"{_fr(_ASSET_CLASS_FR, position.asset_class)} | "
                f"{render.amount(position.market_value_cents)} |"
            )
        return lines
    lines = ["| Instrument | Classe | Quantité | Valorisation |", "| --- | --- | --- | --- |"]
    for position in inputs.positions:
        lines.append(
            f"| {render.instrument(position.symbol, position.name)} | "
            f"{_fr(_ASSET_CLASS_FR, position.asset_class)} | {position.quantity} | "
            f"{render.amount(position.market_value_cents)} |"
        )
    return lines


def _section_recurrences(inputs: ExportInputs, render: _Render) -> list[str]:
    if not inputs.recurrences:
        return ["Aucune récurrence détectée."]
    lines = ["| Ligne | Montant | Périodicité | Coût annuel | État |",
             "| --- | --- | --- | --- | --- |"]
    for item in inputs.recurrences:
        lines.append(
            f"| {render.merchant(item.label)} | {render.amount(item.amount_cents)} | "
            f"{_fr(_PERIODICITY_FR, item.periodicity)} | "
            f"{render.amount(item.annual_cents)} | {_fr(_STATUS_FR, item.status)} |"
        )
    return lines


def _section_projections(inputs: ExportInputs, render: _Render) -> list[str]:
    if inputs.projection is None:
        # The caller's own engine refusal, verbatim. Never softened here, and
        # never replaced by an empty section that would read as "nothing to
        # project" rather than "nothing could be measured".
        return [inputs.projection_unavailable_reason or
                "Aucune projection fournie et aucune cause n'a été indiquée."]
    projection = inputs.projection
    return [
        f"- Horizon : {projection.horizon_months} mois",
        f"- Rendement annuel supposé : {_fmt_rate_bps(projection.annual_rate_bps)}",
        f"- Versement mensuel : {render.amount(projection.monthly_contribution_cents)}",
        f"- Capital de départ : {render.amount(projection.initial_cents)}",
        f"- Capital projeté : {render.amount(projection.final_cents)}",
        "",
        "Ces cinq lignes sont une hypothèse, pas une prévision : le rendement est "
        "déclaré, il n'est pas mesuré.",
    ]


def _section_fiscalite(inputs: ExportInputs, render: _Render) -> list[str]:
    if inputs.tax is None:
        return [inputs.tax_unavailable_reason or
                "Aucun calcul fiscal fourni et aucune cause n'a été indiquée."]
    return [
        f"- Régime : {inputs.tax.regime_label}",
        f"- Plus-value latente : {render.amount(inputs.tax.gain_cents)}",
        f"- Imposition estimée : {render.amount(inputs.tax.tax_cents)}",
    ]


# --------------------------------------------------------------------------
# The document.
# --------------------------------------------------------------------------


def _scope_section(
    inputs: ExportInputs, scope: ExportScope, start: date, end: date,
    kept: int, transfers: int, render: _Render,
) -> list[str]:
    if scope.account_ids is None:
        accounts = "tous"
    else:
        names = [render.account(account.name) for account in _scoped_accounts(inputs, scope)]
        accounts = ", ".join(names) if names else "aucun"
    if scope.category_ids is None:
        categories = "toutes"
    else:
        names = [
            name for cid, name in sorted(inputs.categories.items())
            if cid in scope.category_ids
        ]
        categories = ", ".join(names) if names else "aucune"

    modules = ", ".join(MODULE_TITLES[module] for module in scope.modules) or "aucun"
    lines = [
        f"- Période : du {start.isoformat()} au {end.isoformat()} (bornes incluses)",
        f"- Comptes : {accounts}",
        f"- Catégories : {categories}",
        f"- Granularité : {GRANULARITY_LABELS[scope.granularity]}",
        f"- Modules : {modules}",
        f"- Opérations retenues : {kept}",
        f"- Virements internes exclus : {transfers}",
    ]
    if render.anonymise:
        lines += [
            "- Anonymisation : activée. Les marchands, comptes, dettes, objectifs et "
            "instruments sont remplacés par des pseudonymes stables ; aucun montant "
            "absolu et aucune devise n'apparaissent.",
            "- Les montants sont exprimés en part de la base 100, laquelle vaut le "
            "total des sorties du périmètre. Ce total n'est pas communiqué.",
            "- Les noms de catégories sont conservés : ils décrivent une nature de "
            "dépense, pas une contrepartie.",
        ]
    else:
        lines += [
            f"- Anonymisation : désactivée. Devise : {inputs.reporting_currency}.",
        ]
    lines += [
        "",
        "Tout ce qui n'est pas listé ci-dessus a été exclu du document : ce n'est "
        "pas une absence de données, c'est le périmètre demandé.",
    ]
    return lines


def build_context_export(
    inputs: ExportInputs, scope: ExportScope, target: TargetModel | None, today: date
) -> ExportDocument:
    """One scoped Markdown document, its token estimate, and its warning.

    Raises `ValueError` when anonymisation is asked for on a scope with no
    spending at all: there is then no base to express a share of, and a table
    of "0,0 %" would be a fabricated document rather than an anonymised one.
    The caller translates it the way every router in this codebase does.
    """
    dates = [row.on for row in inputs.transactions]
    start, end = resolve_range(
        scope.date_from, scope.date_to,
        min(dates) if dates else None, max(dates) if dates else None, today,
    )
    rows, transfers = select_transactions(inputs.transactions, scope, start, end)

    base_cents = -sum(row.amount_cents for row in rows if row.amount_cents < 0)
    if scope.anonymise and base_cents == 0:
        raise ValueError(
            "L'anonymisation en valeurs relatives est impossible : aucune dépense "
            "n'a été observée sur ce périmètre, il n'existe donc aucune base de "
            "référence. Élargissez la période ou désactivez l'anonymisation."
        )

    render = _Render(
        anonymise=scope.anonymise, currency=inputs.reporting_currency,
        base_cents=base_cents or 1, masker=_Masker(),
    )

    # Merchants are masked in FIRST-SEEN order over the rows as they will be
    # printed, so "Marchand 1" is the first merchant of the document rather
    # than whichever one a dictionary happened to yield first.
    if scope.anonymise:
        for row in rows:
            render.merchant(row.label)

    body: list[str] = [
        "# Contexte financier — Yieldo",
        "",
        "Document généré par Yieldo pour être lu par un modèle de langage. "
        "Tous les chiffres proviennent des moteurs déterministes de Yieldo ; "
        "aucun n'a été produit par un modèle.",
        "",
        "## Périmètre",
        "",
    ]
    body += _scope_section(inputs, scope, start, end, len(rows), transfers, render)

    renderers = {
        "profil": lambda: _section_profil(inputs, scope, rows, render, start, end),
        "budget": lambda: _section_budget(rows, render),
        "patrimoine": lambda: _section_patrimoine(inputs, scope, render),
        "dettes": lambda: _section_dettes(inputs, render),
        "objectifs": lambda: _section_objectifs(inputs, render),
        "positions": lambda: _section_positions(inputs, render),
        "recurrences": lambda: _section_recurrences(inputs, render),
        "analyses": lambda: _section_analyses(rows, scope, render),
        "projections": lambda: _section_projections(inputs, render),
        "fiscalite": lambda: _section_fiscalite(inputs, render),
    }

    sections: list[Module] = []
    for module in MODULES:
        if module not in scope.modules:
            continue
        sections.append(module)
        body += ["", f"## {MODULE_TITLES[module]}", ""]
        body += renderers[module]()

    markdown = "\n".join(body) + "\n"
    estimated = estimate_tokens(markdown)
    return ExportDocument(
        markdown=markdown,
        estimated_tokens=estimated,
        warning=_window_warning(estimated, target),
        transaction_count=len(rows),
        excluded_transfer_count=transfers,
        date_from=start,
        date_to=end,
        sections=tuple(sections),
    )


# A model needs room for its own answer, not only for the document. Reserving
# a fifth of the window is a declared convention, printed in the warning
# itself rather than applied behind the reader's back.
_ANSWER_RESERVE_NUMERATOR = 4
_ANSWER_RESERVE_DENOMINATOR = 5


def _window_warning(estimated: int, target: TargetModel | None) -> str | None:
    if target is None:
        return None
    usable = target.context_tokens * _ANSWER_RESERVE_NUMERATOR // _ANSWER_RESERVE_DENOMINATOR
    if estimated <= usable:
        return None
    return (
        f"Ce document est estimé à {_fmt_int(estimated)} tokens, pour une fenêtre de "
        f"{_fmt_int(target.context_tokens)} tokens ({target.label}) dont "
        f"{_fmt_int(usable)} utilisables une fois réservée la place de la réponse. "
        f"Réduisez la granularité, la période ou le nombre de modules avant de le "
        f"transmettre : au-delà de la fenêtre, le modèle ne lira pas la fin du "
        f"document et ne dira pas qu'il l'a perdue."
    )


def _fmt_int(value: int) -> str:
    return f"{value:,}".replace(",", " ")


# --------------------------------------------------------------------------
# The five ready-made templates. Design §8.2.
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ExportTemplate:
    """A pre-selected scope plus the question to put to the model.

    The question travels WITH the scope on purpose: a document assembled for
    a tax review and a document assembled for a budget diagnosis are not the
    same document, and handing a model the wrong question over the right data
    is how it starts inventing the parts it was not given.

    `account_ids` and `category_ids` are `None` on every template -- a preset
    that silently dropped one of the household's accounts would answer a
    narrower question than the one it names. The reader narrows them.
    """

    key: str
    label: str
    summary: str
    question: str
    scope: ExportScope


def _last_complete_year(today: date) -> tuple[date, date]:
    """The last year that has actually finished. A "bilan annuel" of a year
    still running is a bilan of however many months have elapsed, which is not
    what the word means."""
    year = today.year - 1
    return date(year, 1, 1), date(year, 12, 31)


def _months_back(today: date, count: int) -> tuple[date, date]:
    """The `count` complete calendar months ending with the last COMPLETE one.

    The current month is excluded: a month still running is not an
    observation, and averaging it in reports a drop that is only the calendar.
    `month_end` + `bucket_bounds` is the same month-edge arithmetic
    `engines/aggregate.py` and `engines/intent.py` use, so a boundary is never
    cut differently in two places.
    """
    end = month_end(today, -1)
    start, _ = bucket_bounds(bucket_key(month_end(today, -count), "month"), "month")
    return start, end


def build_templates(today: date) -> tuple[ExportTemplate, ...]:
    """The five design §8.2 names, in its order. `today` is a parameter."""
    year_start, year_end = _last_complete_year(today)
    twelve_start, twelve_end = _months_back(today, 12)
    six_start, six_end = _months_back(today, 6)

    def scope(
        start: date, end: date, granularity: Granularity, modules: tuple[Module, ...]
    ) -> ExportScope:
        return ExportScope(
            date_from=start, date_to=end, account_ids=None, category_ids=None,
            granularity=granularity, modules=modules, anonymise=False,
        )

    return (
        ExportTemplate(
            key="bilan-annuel",
            label="Bilan annuel",
            summary=(
                f"L'année {year_start.year} entière, mois par mois, avec les comptes, "
                "les dettes, les objectifs et les récurrences."
            ),
            question=(
                f"Voici le bilan de mon année {year_start.year}. Résume ce qui a le plus "
                "pesé, ce qui a changé d'un mois sur l'autre, et les trois points sur "
                "lesquels agir en priorité. N'utilise que les chiffres de ce document : "
                "n'en calcule aucun autre et n'en invente aucun."
            ),
            scope=scope(year_start, year_end, "monthly",
                        ("profil", "budget", "analyses", "patrimoine", "dettes",
                         "objectifs", "recurrences")),
        ),
        ExportTemplate(
            key="faisabilite-achat",
            label="Faisabilité d'achat",
            summary=(
                "Les douze derniers mois complets, avec la capacité d'épargne, les "
                "dettes en cours, les objectifs déjà engagés et la projection."
            ),
            question=(
                "Je veux savoir si un achat important est envisageable. À partir de ce "
                "document, dis-moi ce que mes flux permettent, ce qu'ils ne permettent "
                "pas, et à quelles conditions. Si le document ne contient pas de quoi "
                "trancher, dis-le au lieu de l'estimer."
            ),
            scope=scope(twelve_start, twelve_end, "monthly",
                        ("profil", "budget", "analyses", "dettes", "objectifs",
                         "patrimoine", "projections")),
        ),
        ExportTemplate(
            key="revue-portefeuille",
            label="Revue de portefeuille",
            summary=(
                "Les positions détenues, leur valorisation, la projection et la "
                "fiscalité d'une cession, sur les douze derniers mois complets."
            ),
            question=(
                "Passe en revue mon portefeuille : concentration, classes d'actifs "
                "sur- ou sous-représentées, ce qui manque. Les valorisations de ce "
                "document sont les seules à utiliser ; ne recalcule aucune performance."
            ),
            scope=scope(twelve_start, twelve_end, "annual",
                        ("patrimoine", "positions", "projections", "fiscalite")),
        ),
        ExportTemplate(
            key="optimisation-fiscale",
            label="Optimisation fiscale",
            summary=(
                f"L'année {year_start.year}, les enveloppes détenues et l'imposition "
                "qu'une cession déclencherait."
            ),
            question=(
                "Au vu de ce document, quelles enveloppes et quels arbitrages "
                "réduiraient mon imposition en France ? Rappelle les règles applicables "
                "et dis explicitement ce que tu ne peux pas trancher sans information "
                "supplémentaire. Tu n'es pas mon conseiller fiscal."
            ),
            scope=scope(year_start, year_end, "annual",
                        ("profil", "patrimoine", "positions", "fiscalite")),
        ),
        ExportTemplate(
            key="diagnostic-budgetaire",
            label="Diagnostic budgétaire",
            summary=(
                "Les six derniers mois complets, poste par poste, avec les "
                "prélèvements récurrents détectés."
            ),
            question=(
                "Analyse mon budget : quels postes dérivent, quels abonnements méritent "
                "d'être revus, quelle marge est réaliste. Chaque recommandation doit "
                "citer un chiffre présent dans ce document."
            ),
            scope=scope(six_start, six_end, "monthly",
                        ("profil", "budget", "analyses", "recurrences")),
        ),
    )
