"""Subida de medios (Fase 1). El archivo se guarda en MEDIA_DIR y se sirve en /media/.
Nota: tus (subida reanudable) se agrega cuando haya medios grandes (video)."""
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from .config import MAX_UPLOAD_BYTES, MEDIA_DIR

router = APIRouter()

_ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/x-m4a",
    "video/mp4",
    "video/webm",
}


@router.post("/uploads", status_code=201)
async def upload_media(file: UploadFile = File(...)):
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="tipo de archivo no permitido")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="archivo demasiado grande")
    ext = Path(file.filename or "").suffix or ""
    name = f"{uuid.uuid4().hex}{ext}"
    dest = MEDIA_DIR / name
    dest.write_bytes(data)
    return {"href": f"/media/{name}", "filename": file.filename, "size": len(data)}
