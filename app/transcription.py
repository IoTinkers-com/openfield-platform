"""Motores de transcripción de audio (ADR-0007).

Cada transcripción registra qué motor la generó (`engine`). El motor real es
faster-whisper (MIT); el stub permite la Fase 1 sin dependencias pesadas.
"""
import os
import tempfile

ENGINES = {}


def register_engine(name, fn):
    ENGINES[name] = fn


def transcribe(audio_bytes: bytes, engine: str | None = None) -> dict:
    name = engine or "stub"
    fn = ENGINES.get(name)
    if fn is None:
        return {"text": "", "engine": name, "error": f"motor no disponible: {name}"}
    try:
        return {"text": fn(audio_bytes), "engine": name}
    except Exception as exc:  # pragma: no cover
        return {"text": "", "engine": name, "error": str(exc)}


def _stub(_audio: bytes) -> str:
    return "(transcripción no disponible: motor stub — instala faster-whisper para el motor real)"


register_engine("stub", _stub)

# Motor real (opcional): se registra solo si faster-whisper está instalado.
try:
    from faster_whisper import WhisperModel  # noqa: F401

    _model = None

    def _whisper(audio_bytes: bytes) -> str:
        global _model
        if _model is None:
            _model = WhisperModel("base", device="cpu", compute_type="int8")
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(audio_bytes)
            path = f.name
        try:
            segments, _ = _model.transcribe(path)
            return "".join(s.text for s in segments).strip()
        finally:
            os.unlink(path)

    register_engine("whisper", _whisper)
except ImportError:
    pass
