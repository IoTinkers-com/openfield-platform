// Flujo de captura: produce documentos canónicos usando la capa de hardware.
// `hw` es inyectable (default: simulada) para poder usar la implementación web en el navegador.
import { newId, now } from "./ids.js";
import { simulatedHardware } from "./hardware/simulated.js";

const TENANT_ID = "tenant-001";
const SCHEMA_VERSION = "1.0";

function toPoint(loc) {
  return loc ? { type: "Point", coordinates: [loc.lon, loc.lat] } : null;
}

export function createDevice(deviceId = newId("dev"), hw = simulatedHardware()) {
  const caps = hw.capabilities();
  return {
    schema_version: SCHEMA_VERSION,
    tenant_id: TENANT_ID,
    id: deviceId,
    name: "Wearable",
    device_capabilities: {
      model: "web",
      os: "n/a",
      thermal_level: caps.thermal_level,
      thermal_sensor_model: null,
      thermal_resolution: null,
      gps: caps.gps,
      audio: caps.audio,
      offline: true,
    },
    created_at: now(),
  };
}

export async function startSession({ deviceId, assetId = null, operator = "operador" } = {}, hw = simulatedHardware()) {
  const caps = hw.capabilities();
  const loc = await hw.getLocation();
  return {
    schema_version: SCHEMA_VERSION,
    tenant_id: TENANT_ID,
    id: newId("sess"),
    device_id: deviceId,
    operator,
    asset_id: assetId,
    started_at: now(),
    ended_at: null,
    location: toPoint(loc),
    device_capabilities: { thermal_level: caps.thermal_level, gps: caps.gps, audio: caps.audio },
    // D15: consentimiento + indicador de grabación antes de capturar.
    consent: { recorded: true, method: "checkbox" },
    created_at: now(),
  };
}

export function endSession(session) {
  return { ...session, ended_at: now() };
}

// Metadatos de foto de la pantalla de confirmación (ADR-0024). Se truncan a los
// límites del esquema y las claves ausentes no se emiten.
const _PHOTO_META_LIMITS = { caption: 500, category: 50, category_label: 100, camera_label: 200 };

export function photoMetadata({ caption, category, categoryLabel, cameraLabel, width, height } = {}) {
  const m = {};
  const put = (k, v, max) => { if (v) m[k] = String(v).slice(0, max); };
  put("caption", caption, _PHOTO_META_LIMITS.caption);
  put("category", category, _PHOTO_META_LIMITS.category);
  put("category_label", categoryLabel, _PHOTO_META_LIMITS.category_label);
  put("camera_label", cameraLabel, _PHOTO_META_LIMITS.camera_label);
  if (Number.isFinite(width)) m.width = Math.trunc(width);
  if (Number.isFinite(height)) m.height = Math.trunc(height);
  return m;
}

export async function captureImage({ sessionId, assetId, href, geometry, seq = 1, metadata } = {}, hw = simulatedHardware()) {
  const img = href ? { href } : hw.captureImage(seq); // { href, blob? }
  // `geometry` es GeoJSON ya listo; si no viene, se deriva del {lon,lat} del hardware.
  const geom = geometry !== undefined ? geometry : toPoint(await hw.getLocation());
  const doc = {
    schema_version: SCHEMA_VERSION,
    tenant_id: TENANT_ID,
    id: newId("media"),
    session_id: sessionId,
    asset_id: assetId,
    type: "image",
    captured_at: now(),
    geometry: geom,
    assets: { primary: { href: img.href, media_type: "image/jpeg" } },
    thermal_capture_id: null,
    transcript_id: null,
    created_at: now(),
  };
  if (metadata && Object.keys(metadata).length) doc.metadata = metadata;
  return doc;
}

export function recordAudio({ sessionId, assetId, mediaItemId = null, engine = "simulated", text = "(transcripción pendiente)", language = "es" } = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    tenant_id: TENANT_ID,
    id: newId("tr"),
    media_item_id: mediaItemId,
    session_id: sessionId,
    asset_id: assetId,
    text,
    language,
    engine, // D7: registrar qué motor generó la transcripción
    confidence: 0.95,
    created_at: now(),
  };
}

// Nota/comentario de terreno escrito con el teclado nativo (ADR-0023).
export function recordNote({ sessionId, assetId, mediaItemId = null, text } = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    tenant_id: TENANT_ID,
    id: newId("obs"),
    asset_id: assetId,
    session_id: sessionId,
    media_item_id: mediaItemId,
    type: "note",
    value: text,
    unit: null,
    observed_at: now(),
    form_response_id: null,
    metadata: {},
    created_at: now(),
  };
}
