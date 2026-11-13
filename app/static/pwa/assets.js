// Catálogo offline de activos y verificación en terreno (ADR-0022/0023).
// Espejo en JS de las funciones puras de openfield-platform/app/assets_domain.py
// (mismas reglas y mensajes: parseValue, computeVerificationStatus, applyVerificationLocally).
//
// Copia idéntica en openfield-platform/app/static/pwa/assets.js (ADR-0018).

const STATUS_RANK = { pending: 0, in_progress: 1, verified: 2, not_found: 3 };
const ATTR_DONE = new Set(["confirmed", "corrected", "unverifiable"]);
const MAX_ATTR_TEXT = 2000;

const _TRUE_WORDS = new Set(["si", "sí", "true", "1", "x", "yes"]);
const _FALSE_WORDS = new Set(["no", "false", "0"]);
const _DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const _DATE_DMY = /^(\d{2})-(\d{2})-(\d{4})$/;

function norm(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function activeAttrs(typeDoc) {
  const attrs = [...(typeDoc?.attributes || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return attrs.filter((a) => a.active !== false);
}

export function relevantAttrs(typeDoc) {
  return activeAttrs(typeDoc).filter((a) => a.verify_in_field !== false);
}

export function attrMap(typeDoc) {
  const map = {};
  for (const a of typeDoc?.attributes || []) map[a.key] = a;
  return map;
}

// Espejo de parse_value (Python). Devuelve el valor convertido o null; lanza Error.
export function parseValue(attrDef, raw) {
  const t = attrDef?.type;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    raw = raw.trim();
    if (raw === "") return null;
  }
  if (t === "number") {
    if (typeof raw === "boolean") throw new Error(`'${raw}' no es un número`);
    if (typeof raw === "number") return raw;
    const s = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw;
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error(`'${raw}' no es un número`);
    return v;
  }
  if (t === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw !== "string") throw new Error(`'${raw}' no es sí/no`);
    const w = raw.toLowerCase();
    if (_TRUE_WORDS.has(w)) return true;
    if (_FALSE_WORDS.has(w)) return false;
    throw new Error(`'${raw}' no es sí/no`);
  }
  if (t === "date") {
    if (typeof raw !== "string") throw new Error("la fecha debe ser texto");
    if (_DATE_ISO.test(raw)) return raw;
    const m = raw.match(_DATE_DMY);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    throw new Error(`'${raw}' no es una fecha válida (YYYY-MM-DD o DD-MM-YYYY)`);
  }
  if (t === "select") {
    if (typeof raw !== "string") throw new Error("el valor debe ser una opción");
    const options = attrDef.options || [];
    for (const opt of options) {
      if (typeof opt === "string" && opt.toLowerCase() === raw.toLowerCase()) return opt;
    }
    throw new Error(`'${raw}' no está entre las opciones: ${options.join(", ")}`);
  }
  if (typeof raw !== "string") throw new Error("el valor debe ser texto");
  if (raw.length > MAX_ATTR_TEXT) throw new Error(`texto demasiado largo (máx. ${MAX_ATTR_TEXT})`);
  return raw;
}

// Espejo de compute_verification_status (Python).
export function computeVerificationStatus(asset, typeDoc) {
  if (asset?.verification_status === "not_found") return "not_found";
  if (!typeDoc) return asset?.verification_status || "pending";
  const verification = asset?.attribute_verification || {};
  const attributes = asset?.attributes || {};
  const relevant = relevantAttrs(typeDoc).filter(
    (a) => attributes[a.key] !== null && attributes[a.key] !== undefined || a.required,
  );
  if (!relevant.length) return asset?.verified_at ? "verified" : "pending";
  const states = relevant.map((a) => verification[a.key]?.status || "pending");
  if (states.every((s) => ATTR_DONE.has(s))) return "verified";
  if (states.some((s) => s !== "pending")) return "in_progress";
  return "pending";
}

export function buildVerifyPayload({ opId, sessionId = null, results = [], assetNotFound = false, note = null } = {}) {
  return {
    op_id: opId,
    session_id: sessionId,
    results,
    asset_not_found: assetNotFound,
    note,
  };
}

// Espejo de apply_verification (Python), versión optimista para el catálogo en caché.
export function applyVerificationLocally(asset, typeDoc, payload, nowIso) {
  const now = nowIso || new Date().toISOString();
  const attrs = attrMap(typeDoc);
  const av = (asset.attribute_verification = asset.attribute_verification || {});
  const attributes = (asset.attributes = asset.attributes || {});
  if (payload.asset_not_found) {
    asset.verification_status = "not_found";
    asset.updated_at = now;
    return asset;
  }
  for (const r of payload.results || []) {
    const key = r.key;
    const def = attrs[key];
    if (!def) throw new Error(`atributo desconocido: ${key}`);
    if (def.active === false) throw new Error(`atributo inactivo: ${key}`);
    const prev = av[key] || {};
    if (r.action === "confirm") {
      if (attributes[key] === null || attributes[key] === undefined) {
        throw new Error(`'${key}' no tiene valor que confirmar; usa corregir`);
      }
      av[key] = { status: "confirmed", previous_value: prev.previous_value, verified_at: now, session_id: payload.session_id };
    } else if (r.action === "unverifiable") {
      av[key] = { status: "unverifiable", previous_value: prev.previous_value, verified_at: now, session_id: payload.session_id };
    } else if (r.action === "correct") {
      if (r.value === null || r.value === undefined) throw new Error(`'${key}': corregir exige un valor`);
      const newValue = typeof r.value === "string" ? parseValue(def, r.value) : r.value;
      const old = attributes[key];
      attributes[key] = newValue;
      av[key] = { status: "corrected", previous_value: old, verified_at: now, session_id: payload.session_id };
    } else {
      throw new Error(`acción desconocida: ${r.action}`);
    }
  }
  asset.verification_status = computeVerificationStatus(asset, typeDoc);
  if (asset.verification_status === "verified" && !asset.verified_at) asset.verified_at = now;
  asset.updated_at = now;
  return asset;
}

// Activo enrolado en terreno (ADR-0022): data_source "field", ya verificado.
export function newFieldAsset({ tenantId, id, identId, type, name, tag, attributes = {}, status = "in_service", sessionId = null, lon = null, lat = null, now: nowIso } = {}) {
  const now = nowIso || new Date().toISOString();
  const attrs = attrMap(type);
  const attribute_verification = {};
  for (const key of Object.keys(attributes)) {
    if (attributes[key] !== null && attributes[key] !== undefined && attrs[key]) {
      attribute_verification[key] = { status: "confirmed", previous_value: null, verified_at: now, session_id: sessionId };
    }
  }
  const asset = {
    schema_version: "1.0",
    tenant_id: tenantId,
    id,
    name,
    category: type?.name || null,
    asset_type_id: type?.id || null,
    location: lon != null && lat != null ? { type: "Point", coordinates: [lon, lat] } : null,
    parent_id: null,
    functional_location: null,
    manufacturer: null,
    model: null,
    serial_number: null,
    criticality: null,
    status,
    status_reason: null,
    status_changed_at: now,
    commissioned_at: null,
    decommissioned_at: null,
    attributes,
    attribute_verification,
    verification_status: "verified",
    verified_at: now,
    data_source: "field",
    import_batch_id: null,
    created_at: now,
    updated_at: null,
  };
  const identifier = tag
    ? {
        schema_version: "1.0",
        tenant_id: tenantId,
        id: identId,
        asset_id: id,
        type: "tag",
        value: tag,
        source: "field",
        confidence: null,
        created_at: now,
      }
    : null;
  return { asset, identifier };
}

export async function loadCatalog({ baseUrl = "", store, tenantId, fetchFn = fetch } = {}) {
  const readCache = async () => {
    const assets = (await store.get("kv", "catalog.assets"))?.value ?? [];
    const types = (await store.get("kv", "catalog.types"))?.value ?? [];
    const identifiers = (await store.get("kv", "catalog.identifiers"))?.value ?? [];
    const updated_at = (await store.get("kv", "catalog.updated_at"))?.value ?? null;
    return { assets, types, identifiers, fromCache: true, updated_at };
  };
  try {
    const [ra, rt, ri] = await Promise.all([
      fetchFn(`${baseUrl}/admin/assets?limit=500&tenant_id=${encodeURIComponent(tenantId)}`),
      fetchFn(`${baseUrl}/admin/asset-types?tenant_id=${encodeURIComponent(tenantId)}`),
      fetchFn(`${baseUrl}/documents?entity_type=asset-identifier&tenant_id=${encodeURIComponent(tenantId)}`),
    ]);
    if (!ra.ok || !rt.ok) throw new Error(`catalog failed: ${ra.status}/${rt.status}`);
    const [assets, types] = await Promise.all([ra.json(), rt.json()]);
    const list = Array.isArray(assets) ? assets : assets.items || [];
    const identifiers = ri.ok ? await ri.json() : [];
    const updated_at = new Date().toISOString();
    if (store) {
      await store.put("kv", { key: "catalog.assets", value: list });
      await store.put("kv", { key: "catalog.types", value: types });
      await store.put("kv", { key: "catalog.identifiers", value: identifiers });
      await store.put("kv", { key: "catalog.updated_at", value: updated_at });
    }
    return { assets: list, types, identifiers, fromCache: false, updated_at };
  } catch (e) {
    if (store) return readCache();
    throw e;
  }
}

// Mapa asset_id -> [tags] para búsqueda y resolución QR offline.
export function tagsByAsset(identifiers) {
  const map = {};
  for (const ident of identifiers || []) {
    if (!ident?.asset_id || !ident?.value) continue;
    (map[ident.asset_id] = map[ident.asset_id] || []).push(ident.value);
  }
  return map;
}

// Resuelve un valor QR/TAG contra el catálogo en caché (sin conexión).
export function findAssetByTag(assets, identifiers, value) {
  const needle = norm(value).trim();
  for (const ident of identifiers || []) {
    if (norm(ident?.value).trim() === needle) {
      return (assets || []).find((a) => a.id === ident.asset_id) || null;
    }
  }
  return null;
}

export function searchAssets(assets, q, { pendingOnly = false, tagsByAsset = {} } = {}) {
  const needle = norm((q || "").trim());
  const rows = (assets || []).filter(
    (a) => a && a.status !== "decommissioned" && !a.deleted_at,
  );
  const match = (a) => {
    if (!needle) return true;
    const fields = [a.name, a.serial_number, a.functional_location, a.id, ...(tagsByAsset[a.id] || [])];
    return fields.some((f) => norm(f).includes(needle));
  };
  const out = rows.filter(match).filter((a) => !pendingOnly || (a.verification_status || "pending") !== "verified");
  out.sort((a, b) => {
    const ra = STATUS_RANK[a.verification_status || "pending"] ?? 0;
    const rb = STATUS_RANK[b.verification_status || "pending"] ?? 0;
    if (ra !== rb) return ra - rb;
    return (a.name || "").localeCompare(b.name || "");
  });
  return out;
}
