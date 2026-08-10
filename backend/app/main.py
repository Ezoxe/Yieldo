import os
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api import accounts as account_routes
from app.api import analytics as analytics_routes
from app.api import auth as auth_routes
from app.api import categories as category_routes
from app.api import imports as import_routes
from app.api import transactions as transaction_routes
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

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": settings.version}


api.include_router(auth_routes.router)
api.include_router(account_routes.router)
api.include_router(import_routes.router)
api.include_router(transaction_routes.router)
api.include_router(category_routes.router)
api.include_router(analytics_routes.router)

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
    candidate = (root / full_path).resolve()
    if not candidate.is_relative_to(root):
        raise HTTPException(status_code=403, detail="Chemin non autorisé")

    if full_path and candidate.is_file():
        return FileResponse(candidate)

    index = root / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(status_code=503, detail="L'interface n'est pas construite.")
