"""Motores de transcripción de audio (ADR-0007).

Cada transcripción registra qué motor la generó (`engine`). Motores:
- `whisper`: faster-whisper (MIT), el motor real. Modelo configurable via WHISPER_MODEL (default "base").
- `stub`: marcador de posición (sin dependencias), usado solo si whisper no está disponible.
"""
import os
import tempfile

MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")

ENGINES = {}


def register_engine(name, fn):
    ENGINES[name] = fn


def _stub(_audio: bytes, _language: str | None = None) -> str:
    return "(transcripción no disponible: motor stub — instala faster-whisper para el motor real)"


register_engine("stub", _stub)


def _load_whisper():
    try:
        from faster_whisper import WhisperModel

        _model = None

        def _whisper(audio_bytes: bytes, language: str | None = None) -> str:
            nonlocal _model
            if _model is None:
                _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
                f.write(audio_bytes)
                path = f.name
            try:
                segments, _ = _model.transcribe(path, language=language)
                return "".join(s.text for s in segments).strip()
            finally:
                os.unlink(path)

        return _whisper
    except ImportError:
        return None


_whisper_fn = _load_whisper()
if _whisper_fn is not None:
    register_engine("whisper", _whisper_fn)

DEFAULT_ENGINE = "whisper" if "whisper" in ENGINES else "stub"


def transcribe(
    audio_bytes: bytes, engine: str | None = None, language: str | None = None
) -> dict:
    name = engine or DEFAULT_ENGINE
    fn = ENGINES.get(name)
    if fn is None:
        return {"text": "", "engine": name, "error": f"motor no disponible: {name}"}
    try:
        return {"text": fn(audio_bytes, language), "engine": name}
    except Exception as exc:  # pragma: no cover
        return {"text": "", "engine": name, "error": str(exc)}
