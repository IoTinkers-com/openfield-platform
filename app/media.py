"""Subida de medios (Fase 1). El archivo se guarda en MEDIA_DIR y se sirve en /media/.
Nota: tus (subida reanudable) se agrega cuando haya medios grandes (video)."""
import uuid
from pathlib import Path

from fastapi import APIRouter, File, UploadFile

from .config import MEDIA_DIR

router = APIRouter()


@router.post("/uploads", status_code=201)
async def upload_media(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix or ""
    name = f"{uuid.uuid4().hex}{ext}"
    dest = MEDIA_DIR / name
    data = await file.read()
    dest.write_bytes(data)
    return {"href": f"/media/{name}", "filename": file.filename, "size": len(data)}
