"""Server-side PDF reports. Design §10 -- "les hypothèses ... sont toujours
affichées à côté du résultat" -- and phase 4 plan Task 9.

**No figure in this module's output may come from anywhere but an engine.**
`render_bilan_pdf` below takes a `ReportInputs`, a plain bag of values the
caller (`api/reports.py`) has already gathered from `engines/capacity.py`,
`engines/portfolio.py`, `engines/savings.py` and the SAME `_build_tax`
`api/projection.py` and `api/export.py` both call -- never a cache presented
as fresh, never a client-supplied value, never a language model's
completion. This module itself touches neither the database nor the
network: it turns numbers that already exist into bytes, nothing more.

**Every assumption is printed beside the result it produced.** A projection
carries its horizon, its assumed annual return and its monthly contribution
on the same page as the capital it yields; a tax figure carries the CGI
article of the regime that produced it (`ExportTax`, reused from
`engines/context_export.py`, already carries both). Design §10's own words:
"Aucun échec n'est silencieux. Aucune valeur de repli ne se fait passer pour
une donnée réelle" -- so a section with nothing to report prints its own
French refusal, sourced from the SAME engine refusal every other screen in
this application already shows, never an empty page and never a silent
omission.

**Dependency: `fpdf2`.** The smallest widely-used library that produces a
REAL PDF from Python: pure-Python core (three small transitive dependencies
-- Pillow, fonttools, defusedxml -- none of them a system library), no
Cairo/Pango/wkhtmltopdf to install alongside it the way an HTML-to-PDF
renderer (WeasyPrint, xhtml2pdf) would need, and a plain imperative API that
fits this module's page-at-a-time, section-at-a-time shape without a
templating layer in between.

**The core-font encoding, and why it is set once, deliberately.** fpdf2's
built-in Helvetica renders through `cp1252` (WinAnsiEncoding) here rather
than the library's own stricter `latin-1` default, because `cp1252` is the
smaller of the two real choices that still covers every accented French
letter AND the euro sign this codebase's own engine sentences already use --
the alternative (a bundled Unicode TrueType font) would need a font file
shipped and licensed for exactly the two extra glyphs `_sanitize` below
handles instead. `→` (used in "Réglages → Connexions") and `−` (the Unicode
minus sign some engines print) are the ONLY characters this codebase's
French strings use that fall outside `cp1252`; `_sanitize` maps them to
ASCII, and everything else -- é, è, à, ç, «, », °, § and € among them --
passes straight through unchanged.
"""

from dataclasses import dataclass
from datetime import date

from fpdf import FPDF

from app.engines.context_export import (
    _ASSET_CLASS_FR,
    _KIND_FR,
    ExportAccount,
    ExportDebt,
    ExportGoal,
    ExportPosition,
    ExportProjection,
    ExportTax,
    _fmt_eur,
    _fmt_rate_bps,
    _fr,
)

TITLE = "Rapport Yieldo — Bilan patrimonial"

DISCLAIMER = (
    "Document généré automatiquement à partir de vos données. Tous les chiffres "
    "proviennent des moteurs déterministes de Yieldo ; aucun n'a été produit par un "
    "modèle de langage. Ce rapport n'est ni un conseil financier ni un conseil fiscal."
)

_ASCII_FALLBACK = {
    "→": "->",  # → -- "Réglages → Connexions"
    "−": "-",  # − -- the Unicode minus sign, distinct from a hyphen
}


def _sanitize(text: str) -> str:
    """The two characters this codebase's French sentences use that fall
    outside `cp1252` -- see the module docstring for why nothing else needs
    mapping."""
    for source, replacement in _ASCII_FALLBACK.items():
        text = text.replace(source, replacement)
    return text


@dataclass(frozen=True)
class ReportInputs:
    """Everything `render_bilan_pdf` needs, already fetched and already
    computed by the caller -- this module never queries anything and never
    calculates anything itself.

    Deliberately reuses `engines.context_export`'s own `ExportAccount` /
    `ExportDebt` / `ExportGoal` / `ExportPosition` / `ExportProjection` /
    `ExportTax` shapes rather than declaring parallel ones: they are already
    exactly what a household's own accounts, debts, goals, positions,
    savings projection and per-envelope tax look like once an engine has
    produced them, and a second, slightly different report-only shape would
    only be a second place for the two to drift apart.
    """

    generated_on: date
    reporting_currency: str
    balance_cents: int
    # `None` together with its reason -- the same "both present or both
    # absent" discipline every other pair in this codebase follows.
    capacity_cents: int | None
    capacity_unavailable_reason: str | None
    net_worth_cents: int | None
    accounts: list[ExportAccount]
    debts: list[ExportDebt]
    goals: list[ExportGoal]
    positions: list[ExportPosition]
    projection: ExportProjection | None
    projection_unavailable_reason: str | None
    tax: ExportTax | None
    tax_unavailable_reason: str | None


class _ReportPdf(FPDF):
    def header(self) -> None:
        self.set_font("helvetica", "B", 16)
        self.cell(0, 10, _sanitize(TITLE), new_x="LMARGIN", new_y="NEXT")
        self.set_font("helvetica", "", 9)
        self.set_text_color(90, 90, 90)
        self.cell(0, 6, f"Généré le {self.generated_on.isoformat()}",
                 new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def footer(self) -> None:
        self.set_y(-15)
        self.set_font("helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")
        self.set_text_color(0, 0, 0)


def _h1(pdf: FPDF, title: str) -> None:
    pdf.ln(4)
    pdf.set_font("helvetica", "B", 13)
    pdf.set_fill_color(230, 244, 240)
    pdf.cell(0, 9, _sanitize(title), new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(1)


def _paragraph(pdf: FPDF, text: str, *, italic: bool = False) -> None:
    pdf.set_font("helvetica", "I" if italic else "", 10)
    pdf.multi_cell(0, 6, _sanitize(text))
    pdf.ln(1)


def _refusal(pdf: FPDF, reason: str) -> None:
    """Every refusal keeps its OWN cause -- the engine's own sentence,
    transcribed verbatim, never replaced by a generic "no data" placeholder.
    Rendered in italics so a reader can tell a refusal from a measurement at
    a glance without having to read every section."""
    _paragraph(pdf, reason, italic=True)


def _kv_line(pdf: FPDF, label: str, value: str) -> None:
    pdf.set_font("helvetica", "B", 10)
    pdf.cell(70, 6, _sanitize(label))
    pdf.set_font("helvetica", "", 10)
    pdf.cell(0, 6, _sanitize(value), new_x="LMARGIN", new_y="NEXT")


def _table(pdf: FPDF, headers: list[str], rows: list[list[str]], widths: list[int]) -> None:
    pdf.set_font("helvetica", "B", 9)
    pdf.set_fill_color(245, 245, 245)
    for header, width in zip(headers, widths, strict=True):
        pdf.cell(width, 7, _sanitize(header), border=1, fill=True)
    pdf.ln()
    pdf.set_font("helvetica", "", 9)
    for row in rows:
        for cell, width in zip(row, widths, strict=True):
            pdf.cell(width, 7, _sanitize(cell), border=1)
        pdf.ln()


# --------------------------------------------------------------------------
# Sections. Each renders a real figure with its assumptions, or its own
# engine refusal -- never both, and never neither.
# --------------------------------------------------------------------------


def _section_profil(pdf: FPDF, inputs: ReportInputs) -> None:
    _h1(pdf, "Profil")
    _kv_line(pdf, "Solde liquide", _fmt_eur(inputs.balance_cents, inputs.reporting_currency))
    if inputs.capacity_cents is None:
        _refusal(pdf, inputs.capacity_unavailable_reason or
                 "Capacité d'épargne non mesurable : aucune cause n'a été indiquée.")
    else:
        _kv_line(pdf, "Capacité d'épargne mesurée (médiane mensuelle)",
                f"{_fmt_eur(inputs.capacity_cents, inputs.reporting_currency)}/mois")


def _section_patrimoine(pdf: FPDF, inputs: ReportInputs) -> None:
    _h1(pdf, "Patrimoine")
    if inputs.net_worth_cents is None:
        _refusal(pdf, "Patrimoine net non calculable : aucun solde de compte n'est connu. "
                 "Déclarez vos comptes pour que cette section ait un contenu.")
    else:
        _kv_line(pdf, "Patrimoine net", _fmt_eur(inputs.net_worth_cents, inputs.reporting_currency))
    if not inputs.accounts:
        _refusal(pdf, "Aucun compte déclaré.")
        return
    pdf.ln(1)
    _table(
        pdf, ["Compte", "Type", "Solde"],
        [
            [account.name, _fr(_KIND_FR, account.kind),
             _fmt_eur(account.balance_cents, inputs.reporting_currency)]
            for account in inputs.accounts
        ],
        [80, 45, 45],
    )


def _section_dettes(pdf: FPDF, inputs: ReportInputs) -> None:
    _h1(pdf, "Dettes")
    if not inputs.debts:
        _refusal(pdf, "Aucune dette déclarée.")
        return
    _table(
        pdf, ["Dette", "Capital restant", "Taux", "Mensualité minimale"],
        [
            [debt.name, _fmt_eur(debt.principal_cents, inputs.reporting_currency),
             _fmt_rate_bps(debt.annual_rate_bps),
             _fmt_eur(debt.minimum_payment_cents, inputs.reporting_currency)]
            for debt in inputs.debts
        ],
        [55, 45, 30, 45],
    )


def _section_objectifs(pdf: FPDF, inputs: ReportInputs) -> None:
    _h1(pdf, "Objectifs")
    if not inputs.goals:
        _refusal(pdf, "Aucun objectif déclaré.")
        return
    _table(
        pdf, ["Objectif", "Cible", "Déjà mis de côté", "Échéance"],
        [
            [goal.name, _fmt_eur(goal.target_cents, inputs.reporting_currency),
             _fmt_eur(goal.saved_cents, inputs.reporting_currency),
             goal.due_on.isoformat() if goal.due_on is not None else "aucune"]
            for goal in inputs.goals
        ],
        [55, 40, 45, 35],
    )


def _section_positions(pdf: FPDF, inputs: ReportInputs) -> None:
    _h1(pdf, "Positions")
    if not inputs.positions:
        _refusal(pdf, "Aucune position déclarée.")
        return
    _table(
        pdf, ["Instrument", "Classe", "Quantité", "Valorisation"],
        [
            [f"{position.symbol} - {position.name}", _fr(_ASSET_CLASS_FR, position.asset_class),
             position.quantity,
             "non valorisé" if position.market_value_cents is None
             else _fmt_eur(position.market_value_cents, inputs.reporting_currency)]
            for position in inputs.positions
        ],
        [70, 35, 35, 35],
    )


def _section_projections(pdf: FPDF, inputs: ReportInputs) -> None:
    _h1(pdf, "Projection")
    if inputs.projection is None:
        _refusal(pdf, inputs.projection_unavailable_reason or
                 "Aucune projection fournie et aucune cause n'a été indiquée.")
        return
    projection = inputs.projection
    _kv_line(pdf, "Horizon", f"{projection.horizon_months} mois")
    _kv_line(pdf, "Rendement annuel supposé", _fmt_rate_bps(projection.annual_rate_bps))
    _kv_line(pdf, "Versement mensuel",
            _fmt_eur(projection.monthly_contribution_cents, inputs.reporting_currency))
    _kv_line(pdf, "Capital de départ",
            _fmt_eur(projection.initial_cents, inputs.reporting_currency))
    _kv_line(pdf, "Capital projeté", _fmt_eur(projection.final_cents, inputs.reporting_currency))
    _paragraph(pdf, "Ces cinq lignes sont une hypothèse, pas une prévision : le "
              "rendement est déclaré, il n'est pas mesuré.", italic=True)


def _section_fiscalite(pdf: FPDF, inputs: ReportInputs) -> None:
    _h1(pdf, "Fiscalité")
    if inputs.tax is None:
        _refusal(pdf, inputs.tax_unavailable_reason or
                 "Aucun calcul fiscal fourni et aucune cause n'a été indiquée.")
        return
    tax = inputs.tax
    _kv_line(pdf, "Plus-value latente totale",
            _fmt_eur(tax.total_unrealised_gain_cents, inputs.reporting_currency))
    _kv_line(pdf, "Imposition totale estimée",
            _fmt_eur(tax.total_tax_cents, inputs.reporting_currency))
    pdf.ln(1)
    for account in tax.accounts:
        pdf.set_font("helvetica", "B", 10)
        pdf.cell(0, 6, _sanitize(account.account_name), new_x="LMARGIN", new_y="NEXT")
        if account.unavailable_reason is not None:
            _refusal(pdf, account.unavailable_reason)
            continue
        pdf.set_font("helvetica", "", 9)
        pdf.multi_cell(0, 5.5, _sanitize(
            f"Régime : {account.regime_label}\n"
            f"Plus-value latente : "
            f"{_fmt_eur(account.unrealised_gain_cents, inputs.reporting_currency)} -- "
            f"Imposition : {_fmt_eur(account.total_tax_cents, inputs.reporting_currency)} -- "
            f"Net après impôt : {_fmt_eur(account.net_gain_cents, inputs.reporting_currency)}"
        ))
        pdf.ln(1)


def render_bilan_pdf(inputs: ReportInputs) -> bytes:
    """The whole report, as PDF bytes. Six sections, each a real figure with
    its assumptions or the engine's own refusal -- see the module docstring.
    """
    pdf = _ReportPdf()
    # See the module docstring: `cp1252` (WinAnsiEncoding) is the smaller of
    # the two real choices that still covers every accented French letter
    # AND the euro sign, without shipping a Unicode font file for the sake
    # of two characters `_sanitize` already normalises to ASCII.
    pdf.core_fonts_encoding = "cp1252"
    pdf.generated_on = inputs.generated_on
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_font("helvetica", "", 10)
    _paragraph(pdf, DISCLAIMER, italic=True)

    _section_profil(pdf, inputs)
    _section_patrimoine(pdf, inputs)
    _section_dettes(pdf, inputs)
    _section_objectifs(pdf, inputs)
    _section_positions(pdf, inputs)
    _section_projections(pdf, inputs)
    _section_fiscalite(pdf, inputs)

    return bytes(pdf.output())
