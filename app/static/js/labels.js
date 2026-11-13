// Etiquetas y badges del registro de activos (ADR-0020/0022).
// Copia idéntica en openfield-platform/app/static/pwa/labels.js y
// openfield-wearable/app/labels.js (duplicación de la capa de app, ADR-0018).

export const STATUS_LABELS = {
  planned: "Planificado",
  in_service: "En servicio",
  standby: "En reserva",
  out_of_service: "Fuera de servicio",
  decommissioned: "Desincorporado",
};

export const VERIFICATION_LABELS = {
  pending: "Pendiente",
  in_progress: "En curso",
  verified: "Verificado",
  not_found: "No encontrado",
};

export const ATTR_VERIFICATION_LABELS = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  corrected: "Corregido",
  unverifiable: "No verificable",
};

const _STATUS_BADGE_CLASS = {
  in_service: "ok",
  standby: "",
  out_of_service: "warn",
  decommissioned: "danger",
  planned: "",
};

const _VERIF_BADGE_CLASS = {
  verified: "ok",
  in_progress: "warn",
  pending: "",
  not_found: "danger",
};

const _ATTR_BADGE_CLASS = {
  confirmed: "ok",
  corrected: "warn",
  unverifiable: "warn",
  pending: "",
};

function _badge(labels, classes, code) {
  const label = labels[code] || code || "—";
  const cls = classes[code] || "";
  return `<span class="of-badge ${cls}">${label}</span>`;
}

export function statusBadge(code) {
  return _badge(STATUS_LABELS, _STATUS_BADGE_CLASS, code);
}

export function verificationBadge(code) {
  return _badge(VERIFICATION_LABELS, _VERIF_BADGE_CLASS, code);
}

export function attrVerificationBadge(code) {
  return _badge(ATTR_VERIFICATION_LABELS, _ATTR_BADGE_CLASS, code);
}

export const DATA_SOURCE_LABELS = {
  csv_import: "Importación CSV",
  field: "Terreno",
  manual: "Manual",
};

// Categorías de foto predeterminadas (ADR-0024). Un tipo de activo puede
// reemplazarlas por `photo_categories`; sin configuración se usa esta lista.
export const DEFAULT_PHOTO_CATEGORIES = [
  { key: "placa", label: "Placa de datos", active: true },
  { key: "general", label: "Vista general", active: true },
  { key: "detalle", label: "Detalle", active: true },
  { key: "hallazgo", label: "Hallazgo/anomalía", active: true },
  { key: "entorno", label: "Entorno/ubicación", active: true },
];

// Categorías activas de un tipo de activo (o las predeterminadas).
export function photoCategoriesFor(typeDoc) {
  const cats = (typeDoc?.photo_categories || []).filter((c) => c.active !== false);
  return cats.length ? cats : DEFAULT_PHOTO_CATEGORIES;
}

export function photoCategoryLabel(typeDoc, key) {
  if (!key) return "";
  const custom = (typeDoc?.photo_categories || []).find((c) => c.key === key);
  if (custom) return custom.label;
  return DEFAULT_PHOTO_CATEGORIES.find((c) => c.key === key)?.label || key;
}
