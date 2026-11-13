"""Transcripción de audio (ADR-0007): recibe audio y devuelve texto + motor."""
from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from .config import MAX_UPLOAD_BYTES
from .transcription import transcribe

router = APIRouter()


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    engine: str | None = Query(default=None, max_length=40),
    language: str | None = Query(default="es", max_length=10),
):
    audio = await file.read()
    if len(audio) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="archivo demasiado grande")
    return transcribe(audio, engine, language)
