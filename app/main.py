"""OpenField Platform — API de ingesta, consulta y dashboard."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import MEDIA_DIR
from .db import init_db
from .export import router as export_router
from .ingest import router as ingest_router
from .media import router as media_router
from .query import router as query_router
from .resolve import router as resolve_router

MEDIA_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="OpenField Platform", version="0.1.0", lifespan=lifespan)

# Fase 1 (dev): la PWA corre en otro puerto/origen. Restringir en producción.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(ingest_router)
app.include_router(query_router)
app.include_router(export_router)
app.include_router(media_router)
app.include_router(resolve_router)

_STATIC = Path(__file__).parent / "static"
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")
app.mount("/static", StaticFiles(directory=str(_STATIC)), name="static")


@app.get("/")
def index():
    return FileResponse(_STATIC / "index.html")
