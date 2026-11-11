"""OpenField Platform — API de ingesta, consulta y dashboard."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import MEDIA_DIR
from .db import init_db
from .export import router as export_router
from .ingest import router as ingest_router
from .query import router as query_router

MEDIA_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="OpenField Platform", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(ingest_router)
app.include_router(query_router)
app.include_router(export_router)

_STATIC = Path(__file__).parent / "static"
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")
app.mount("/static", StaticFiles(directory=str(_STATIC)), name="static")


@app.get("/")
def index():
    return FileResponse(_STATIC / "index.html")
