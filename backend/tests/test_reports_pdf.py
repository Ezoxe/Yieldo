"""`app/reports/pdf.py`. Tests the actual bytes -- a valid PDF, opened and
its text extracted through `pypdf`, never a mocked renderer -- because a
mock could not catch the one defect this module exists to prevent: a figure
rendered from somewhere other than the engine that produced it, or a
character outside the core font's encoding silently corrupting the page.
"""

import io
from datetime import date

from pypdf import PdfReader

from app.engines.context_export import (
    ExportAccount,
    ExportDebt,
    ExportGoal,
    ExportPosition,
    ExportProjection,
    ExportTax,
    ExportTaxAccount,
)
from app.reports.pdf import ReportInputs, render_bilan_pdf

TODAY = date(2026, 9, 3)


def _extracted_text(data: bytes) -> str:
    """Every page's text, newlines flattened to spaces -- `multi_cell`
    wraps long sentences across lines, and `pypdf` inserts a real newline at
    the wrap point, which would otherwise split a substring a test is
    looking for across two "lines" of the extracted text for no reason
    connected to the report's actual content."""
    reader = PdfReader(io.BytesIO(data))
    return " ".join(page.extract_text() for page in reader.pages).replace("\n", " ")


def _inputs(**overrides) -> ReportInputs:
    base = dict(
        generated_on=TODAY, reporting_currency="EUR",
        balance_cents=-220_963, capacity_cents=-74_619, capacity_unavailable_reason=None,
        net_worth_cents=-220_963,
        accounts=[ExportAccount(id=1, name="Compte courant", kind="checking",
                                balance_cents=-220_963)],
        debts=[], goals=[], positions=[],
        projection=None,
        projection_unavailable_reason="Aucune projection : vous ne détenez aucune position "
                                      "valorisée et votre capacité d'épargne n'est pas mesurable.",
        tax=None,
        tax_unavailable_reason=(
            "Aucune plus-value latente à imposer : vous ne détenez aucune position. La "
            "fiscalité française (PFU, barème, PEA, assurance-vie) porte sur un gain."
        ),
    )
    base.update(overrides)
    return ReportInputs(**base)


# --------------------------------------------------------------------------
# The bytes are a real PDF.
# --------------------------------------------------------------------------


def test_the_output_is_a_real_pdf_pypdf_can_open():
    data = render_bilan_pdf(_inputs())
    assert data.startswith(b"%PDF-")
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) >= 1


# --------------------------------------------------------------------------
# The operator's own state: most sections are refusals, each its own cause.
# --------------------------------------------------------------------------


def test_the_operators_refused_state_names_every_sections_own_cause():
    """The exact shape CLAUDE.md's defect class 5 warns about: a screen only
    tested on a healthy fixture. Every section below is a refusal here, and
    each must carry a DIFFERENT French sentence -- never one generic "no
    data" placeholder repeated six times."""
    text = _extracted_text(render_bilan_pdf(_inputs()))
    # A real, negative measured figure -- proves this is not a fixture that
    # only happens to hold zeros.
    assert "746,19" in text
    assert "2 209,63" in text
    assert "Aucune dette déclarée." in text
    assert "Aucun objectif déclaré." in text
    assert "Aucune position déclarée." in text
    assert "vous ne détenez aucune position valorisée" in text
    assert "PFU, barème, PEA, assurance-vie" in text


def test_a_capacity_refusal_names_its_own_cause_not_a_zero():
    text = _extracted_text(render_bilan_pdf(_inputs(
        capacity_cents=None,
        capacity_unavailable_reason="Votre capacité d'épargne n'a pas pu être mesurée : il "
                                    "faut au moins trois mois complets de relevés.",
    )))
    assert "n'a pas pu être mesurée" in text
    assert "0,00" not in text.split("Profil")[1].split("Patrimoine")[0]


# --------------------------------------------------------------------------
# A populated state: every figure lands beside its own assumption.
# --------------------------------------------------------------------------


def test_a_populated_report_prints_every_figure_with_its_own_assumption():
    inputs = _inputs(
        balance_cents=500_000, capacity_cents=100_000, capacity_unavailable_reason=None,
        net_worth_cents=600_000,
        debts=[ExportDebt(name="Prêt auto Cetelem", principal_cents=800_000,
                          annual_rate_bps=490, minimum_payment_cents=15_000)],
        goals=[ExportGoal(name="Vacances Corse", target_cents=300_000, saved_cents=90_000,
                          due_on=date(2027, 6, 30))],
        positions=[ExportPosition(symbol="MWRD", name="Amundi MSCI World", asset_class="equity",
                                  quantity="12", market_value_cents=216_000)],
        projection=ExportProjection(
            horizon_months=120, annual_rate_bps=500, monthly_contribution_cents=100_000,
            initial_cents=600_000, final_cents=20_000_000,
        ),
        projection_unavailable_reason=None,
        tax=ExportTax(
            accounts=[ExportTaxAccount(
                account_name="PEA Boursorama", account_kind="pea",
                regime_label="PEA exonéré d'impôt sur le revenu (art. 157, 5° bis CGI) — "
                              "17,2 % PS dus",
                unrealised_gain_cents=50_000, income_tax_cents=0, social_levies_cents=8_600,
                total_tax_cents=8_600, net_gain_cents=41_400, unavailable_reason=None,
            )],
            total_unrealised_gain_cents=50_000, total_tax_cents=8_600,
        ),
        tax_unavailable_reason=None,
    )
    text = _extracted_text(render_bilan_pdf(inputs))

    # Patrimoine.
    assert "6 000,00" in text  # net worth
    assert "Compte courant" in text
    # Dettes.
    assert "Prêt auto Cetelem" in text
    assert "4,90 %" in text
    # Objectifs.
    assert "Vacances Corse" in text
    assert "2027-06-30" in text
    # Positions.
    assert "MWRD" in text
    assert "2 160,00" in text
    # Projection -- the assumption AND the result it produced.
    assert "120 mois" in text
    assert "5,00 %" in text
    assert "200 000,00" in text  # the final capital
    # Fiscalité -- the regime AND its CGI article, beside the figure.
    assert "PEA Boursorama" in text
    assert "art. 157" in text
    assert "86,00" in text  # the 17,2% PS on the 500,00 gain


# --------------------------------------------------------------------------
# The one character class this codebase's French sentences use that falls
# outside the core font's encoding -- normalised, not lost.
# --------------------------------------------------------------------------


def test_the_arrow_in_a_reused_sentence_is_normalised_not_dropped():
    text = _extracted_text(render_bilan_pdf(_inputs(
        tax=None,
        tax_unavailable_reason="Voir Réglages → Connexions pour renseigner une clé.",
    )))
    assert "Réglages" in text
    assert "Connexions" in text
    # The arrow itself is outside cp1252; `_sanitize` maps it to "->" rather
    # than raising or silently eating the rest of the sentence.
    assert "->" in text
