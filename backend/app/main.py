from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth as auth_routes
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

app.include_router(api)
