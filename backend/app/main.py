import os
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.api import accounts as account_routes
from app.api import analysis as analysis_routes
from app.api import analytics as analytics_routes
from app.api import auth as auth_routes
from app.api import budgets as budget_routes
from app.api import cashflow as cashflow_routes
from app.api import categories as category_routes
from app.api import connections as connections_routes
from app.api import debts as debt_routes
from app.api import engagement as engagement_routes
from app.api import feasibility as feasibility_routes
from app.api import goals as goal_routes
from app.api import imports as import_routes
from app.api import portfolio as portfolio_routes
from app.api import recurrences as recurrence_routes
from app.api import simulators as simulator_routes
from app.api import transactions as transaction_routes
from app.api.errors import french_validation_detail
from app.config import settings

app = FastAPI(title="Yieldo", version=settings.version, docs_url="/api/docs",
              openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def french_request_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Answer a schema violation in French, like every other error this API returns.

    Replaces FastAPI's default handler, which serves pydantic's English text --
    the frontend renders `detail` verbatim (by design: the backend owns the
    wording), so untranslated here means untranslated on screen.
    """
    return JSONResponse(
        status_code=422,
        content={"detail": french_validation_detail(exc.errors())},
    )


api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": settings.version}


api.include_router(auth_routes.router)
api.include_router(account_routes.router)
api.include_router(import_routes.router)
api.include_router(transaction_routes.router)
api.include_router(category_routes.router)
api.include_router(analysis_routes.router)
api.include_router(analytics_routes.router)
api.include_router(budget_routes.router)
api.include_router(recurrence_routes.router)
api.include_router(cashflow_routes.router)
api.include_router(debt_routes.router)
api.include_router(goal_routes.router)
api.include_router(feasibility_routes.router)
api.include_router(simulator_routes.router)
api.include_router(engagement_routes.router)
api.include_router(connections_routes.router)
api.include_router(portfolio_routes.router)

app.include_router(api)

STATIC_DIR = Path(os.environ.get("YIELDO_STATIC_DIR", "/app/static"))


@app.get("/{full_path:path}", include_in_schema=False)
def serve_spa(full_path: str) -> FileResponse:
    """Serve built frontend assets, and hand every other path to the client-side router.

    Registered last so it never shadows /api routes. An unmatched /api/* path must
    still surface as a plain JSON 404 — never fall back to the SPA shell.
    """
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")

    if not STATIC_DIR.is_dir():
        raise HTTPException(
            status_code=503,
            detail="L'interface n'est pas construite. Lancez ./install.sh install.",
        )

    root = STATIC_DIR.resolve()
    try:
        candidate = (root / full_path).resolve()
    except ValueError:
        # A null byte (e.g. from a "%00"-encoded request path) makes os.stat
        # raise ValueError during resolve() instead of a filesystem error —
        # treat it the same as any other disallowed path, not a server crash.
        raise HTTPException(status_code=403, detail="Chemin non autorisé") from None
    if not candidate.is_relative_to(root):
        raise HTTPException(status_code=403, detail="Chemin non autorisé")

    if full_path and candidate.is_file():
        return FileResponse(candidate)

    index = root / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(status_code=503, detail="L'interface n'est pas construite.")
