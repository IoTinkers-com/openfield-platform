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
