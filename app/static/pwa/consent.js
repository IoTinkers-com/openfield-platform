// Consentimiento versionado (ADR-0026). Sin DOM.
// Copia idéntica en openfield-platform/app/static/pwa/consent.js (ADR-0018).
import { newId, now } from "./ids.js";

export const POLICY = Object.freeze({
  id: "captura-terreno",
  version: "1.0",
  maxAgeDays: 365,
  scopes: ["image", "audio", "location", "text"],
});

// -> "valid" | "missing" | "expired" | "version_changed" | "revoked"
export function consentStatus(record, policy = POLICY, nowIso = now(), { subjectId = null } = {}) {
  if (!record) return "missing";
  if (subjectId && record.subject?.id !== subjectId) return "missing";
  if (record.action === "revoke") return "revoked";
  if (record.policy_id !== policy.id || record.policy_version !== policy.version) return "version_changed";
  const missing = policy.scopes.filter((s) => !(record.scopes || []).includes(s));
  if (missing.length) return "version_changed";
  if (record.expires_at && Date.parse(record.expires_at) <= Date.parse(nowIso)) return "expired";
  return "valid";
}

export function buildConsentRecord({
  tenantId = "tenant-001",
  operator = "operador",
  deviceId = null,
  policy = POLICY,
  action = "grant",
  method = "checkbox",
  nowIso = now(),
} = {}) {
  const grant = action === "grant";
  const name = (operator || "operador").slice(0, 200);
  return {
    schema_version: "1.0",
    tenant_id: tenantId,
    id: newId("cons"),
    subject: { type: "operator", id: name, display_name: name },
    device_id: deviceId,
    policy_id: policy.id,
    policy_version: policy.version,
    action,
    scopes: grant ? [...policy.scopes] : [],
    method,
    occurred_at: nowIso,
    expires_at: grant ? new Date(Date.parse(nowIso) + policy.maxAgeDays * 86400000).toISOString() : null,
    created_at: nowIso,
  };
}

export function sessionConsentRef(record) {
  return {
    recorded: true,
    method: "stored",
    record_id: record.id,
    policy_version: record.policy_version,
    granted_at: record.occurred_at,
  };
}

// Persistencia en kv (clave "consent.current").
export async function loadConsent(store) {
  const rec = await store.get("kv", "consent.current");
  return rec ? rec.value : null;
}

export async function saveConsent(store, record) {
  await store.put("kv", { key: "consent.current", value: record });
}

export const NOTICE_TEXT =
  "Aviso de captura en terreno (v1.0). Mientras uses esta aplicación se registrarán fotos, " +
  "notas de voz, texto y la ubicación del dispositivo, asociados a equipos e instalaciones. " +
  "Evita captar personas y conversaciones ajenas. Los datos se guardan en tu dispositivo y se " +
  "envían a la plataforma de tu organización al sincronizar. Puedes revocar este consentimiento " +
  "en Ajustes. Texto pendiente de revisión legal.";
