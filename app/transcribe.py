"""Transcripción de audio (ADR-0007): recibe audio y devuelve texto + motor."""
from fastapi import APIRouter, File, UploadFile

from .transcription import transcribe

router = APIRouter()


@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), engine: str | None = None):
    audio = await file.read()
    return transcribe(audio, engine)
