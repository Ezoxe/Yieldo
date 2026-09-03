"""`GET /api/reports/bilan` -- one PDF report. Design §10, phase 4 plan
Task 9.

This router does no arithmetic of its own. It reuses `api/export.py`'s own
`_build_inputs` -- accounts, debts, goals, positions, net worth, the savings
projection and the per-envelope tax, already assembled from real engines and
already user-scoped -- and adds the two figures that assembly does not carry
(the measured savings capacity and the liquid balance, the SAME calls
`api/chat.py` and `api/projection.py` already make), then hands the whole
bag to `app.reports.pdf.render_bilan_pdf`. Every figure inside the PDF
therefore traces back to one of the engines every other screen in this
application already reads from -- never a value this router computes itself.

Every query filters on `user_id`, via `get_current_user`, through the same
user-scoped helpers `/api/export` and `/api/chat` already use.
"""

from datetime import date

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.common import liquid_balance_cents
from app.api.export import _build_inputs
from app.api.goals import observed_months
from app.api.projection import _NO_CAPACITY_REASON
from app.db import get_db
from app.engines.capacity import measure_savings_capacity
from app.models import User
from app.reports.pdf import ReportInputs, render_bilan_pdf
from app.security.deps import get_current_user

router = APIRouter(prefix="/reports", tags=["reports"])


def _report_inputs(db: Session, user: User, today: date) -> ReportInputs:
    export_inputs = _build_inputs(db, user, today)
    capacity = measure_savings_capacity(observed_months(db, user.id))
    return ReportInputs(
        generated_on=today, reporting_currency=export_inputs.reporting_currency,
        balance_cents=liquid_balance_cents(db, user.id),
        capacity_cents=None if capacity is None else capacity.median_cents,
        capacity_unavailable_reason=None if capacity is not None else _NO_CAPACITY_REASON,
        net_worth_cents=export_inputs.net_worth_cents,
        accounts=export_inputs.accounts, debts=export_inputs.debts, goals=export_inputs.goals,
        positions=export_inputs.positions,
        projection=export_inputs.projection,
        projection_unavailable_reason=export_inputs.projection_unavailable_reason,
        tax=export_inputs.tax, tax_unavailable_reason=export_inputs.tax_unavailable_reason,
    )


@router.get("/bilan")
def bilan_report(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    today = date.today()
    pdf_bytes = render_bilan_pdf(_report_inputs(db, user, today))
    filename = f"yieldo-bilan-{today.isoformat()}.pdf"
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
