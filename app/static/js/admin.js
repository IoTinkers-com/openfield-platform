// Panel de administración de activos (ADR-0020/0021/0022). HTML/JS plano (D8/ADR-0018).
import {
  STATUS_LABELS,
  VERIFICATION_LABELS,
  ATTR_VERIFICATION_LABELS,
  DATA_SOURCE_LABELS,
  DEFAULT_PHOTO_CATEGORIES,
  statusBadge,
  verificationBadge,
  attrVerificationBadge,
} from "/static/js/labels.js";
import { emptyState, escapeHtml, formatDate } from "/static/js/dossier-common.js";
import { createWizard, toKey, saveDraft, loadDraft, clearDraft, createLocalKv } from "/static/js/wizard.js?v=e2";
import { mountWizard } from "/static/js/wizard-ui.js?v=e2";

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 100;

const state = {
  types: [],
  typesById: new Map(),
  page: 0,
  total: 0,
  editingTypeId: null,
  editingAssetId: null,
  statusAssetId: null,
  previewOk: false,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    cache: "no-store",
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch (_) { /* respuesta no JSON */ }
    throw new Error(detail);
  }
  return res.json();
}

function msg(id, text, cls = "") {
  const el = $(id);
  el.textContent = text || "";
  el.className = `of-status ${cls}`;
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

function showTab(name) {
  for (const t of ["assets", "types", "import", "states", "consents"]) {
    $(`tab-${t}`).style.display = t === name ? "" : "none";
  }
  document.querySelectorAll(".of-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  if (name === "import") loadBatches();
  if (name === "consents") loadConsents();
}

document.querySelectorAll(".of-tab").forEach((b) =>
  b.addEventListener("click", () => {
    location.hash = b.dataset.tab;
    showTab(b.dataset.tab);
  }),
);

// ---------------------------------------------------------------------------
// Tipos de activo
// ---------------------------------------------------------------------------

const ATTR_TYPES = ["text", "number", "boolean", "select", "date"];

async function loadTypes() {
  state.types = await api("/admin/asset-types?include_inactive=true").catch(() => []);
  state.typesById = new Map(state.types.map((t) => [t.id, t]));
  renderTypesList();
  fillTypeSelects();
}

function renderTypesList() {
  const list = $("types-list");
  if (!state.types.length) {
    emptyState(list, { icon: "🏷️", title: "Sin tipos de activo.", hint: "Crea el primero con «+ Nuevo tipo»." });
    return;
  }
  list.innerHTML = state.types
    .map(
      (t) => `<button type="button" class="of-card" style="text-align:left; cursor:pointer; font:inherit" data-type-id="${escapeHtml(t.id)}">
        <strong>${escapeHtml(t.name)}</strong>
        <span class="of-badge">${(t.attributes || []).filter((a) => a.active !== false).length} atributos</span>
        ${t.active === false ? '<span class="of-badge danger">inactivo</span>' : ""}
        <div class="of-popup-id">${escapeHtml(t.id)}</div>
      </button>`,
    )
    .join("");
  list.querySelectorAll("[data-type-id]").forEach((el) =>
    el.addEventListener("click", () => editType(el.dataset.typeId)),
  );
}

function fillTypeSelects() {
  const options = state.types
    .filter((t) => t.active !== false)
    .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
    .join("");
  $("a-type").innerHTML = '<option value="">Todos</option>' + options;
  $("imp-type").innerHTML = options;
  $("f-asset-type").innerHTML = '<option value="">Sin tipo</option>' + options;
  updateTemplateLink();
}

function updateTemplateLink() {
  const tid = $("imp-type").value;
  $("imp-template").href = tid ? `/admin/asset-types/${encodeURIComponent(tid)}/csv-template` : "#";
}

$("imp-type").addEventListener("change", updateTemplateLink);

// ---- Editor de atributos ---------------------------------------------------

function attrRow(a = {}) {
  const tr = document.createElement("div");
  tr.className = "of-attr-row";
  tr.dataset.key = a.key || "";
  const exists = Boolean(a.key);
  tr.innerHTML = `
    <input data-f="key" maxlength="50" pattern="[a-z][a-z0-9_]*" placeholder="clave" value="${escapeHtml(a.key || "")}" ${exists ? "readonly" : ""}>
    <input data-f="label" maxlength="100" placeholder="Etiqueta" value="${escapeHtml(a.label || "")}">
    <select data-f="type">${ATTR_TYPES.map((t) => `<option ${a.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
    <input data-f="unit" maxlength="20" placeholder="unidad" value="${escapeHtml(a.unit || "")}">
    <input data-f="options" placeholder="opciones (separadas por coma)" value="${escapeHtml((a.options || []).join(", "))}">
    <label class="of-attr-flag"><input data-f="required" type="checkbox" ${a.required ? "checked" : ""}> req</label>
    <label class="of-attr-flag"><input data-f="active" type="checkbox" ${a.active !== false ? "checked" : ""}> act</label>
    <label class="of-attr-flag"><input data-f="verify_in_field" type="checkbox" ${a.verify_in_field !== false ? "checked" : ""}> ver</label>
    <span class="of-row-actions">
      <button type="button" data-act="up" class="of-btn" title="Subir">↑</button>
      <button type="button" data-act="down" class="of-btn" title="Bajar">↓</button>
      <button type="button" data-act="del" class="of-btn" title="Quitar">✕</button>
    </span>`;
  tr.querySelectorAll("[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const rows = $("attr-rows");
      if (b.dataset.act === "del") tr.remove();
      if (b.dataset.act === "up" && tr.previousElementSibling?.classList.contains("of-attr-row")) rows.insertBefore(tr, tr.previousElementSibling);
      if (b.dataset.act === "down" && tr.nextElementSibling) rows.insertBefore(tr.nextElementSibling, tr);
    }),
  );
  return tr;
}

function readAttrRows() {
  return [...$("attr-rows").querySelectorAll(".of-attr-row")].map((tr, i) => {
    const get = (f) => tr.querySelector(`[data-f="${f}"]`);
    const type = get("type").value;
    const options = get("options").value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      key: get("key").value.trim(),
      label: get("label").value.trim() || get("key").value.trim(),
      type,
      unit: get("unit").value.trim() || null,
      required: get("required").checked,
      options: type === "select" ? options : null,
      active: get("active").checked,
      order: i,
      verify_in_field: get("verify_in_field").checked,
    };
  });
}

// ---- Editor de categorías de foto (ADR-0024) -------------------------------

function catRow(c = {}) {
  const tr = document.createElement("div");
  tr.className = "of-cat-row";
  tr.innerHTML = `
    <input data-f="key" maxlength="50" pattern="[a-z][a-z0-9_]*" placeholder="clave" value="${escapeHtml(c.key || "")}">
    <input data-f="label" maxlength="100" placeholder="Etiqueta" value="${escapeHtml(c.label || "")}">
    <label class="of-attr-flag"><input data-f="active" type="checkbox" ${c.active !== false ? "checked" : ""}> act</label>
    <button type="button" data-act="del" class="of-btn" title="Quitar">✕</button>`;
  tr.querySelector('[data-act="del"]').addEventListener("click", () => tr.remove());
  return tr;
}

function readCatRows() {
  return [...$("cat-rows").querySelectorAll(".of-cat-row")]
    .map((tr) => ({
      key: tr.querySelector('[data-f="key"]').value.trim(),
      label: tr.querySelector('[data-f="label"]').value.trim(),
      active: tr.querySelector('[data-f="active"]').checked,
    }))
    .filter((c) => c.key)
    .map((c) => ({ ...c, label: c.label || c.key }));
}

function fillCatRows(cats) {
  const rows = $("cat-rows");
  rows.innerHTML = "";
  for (const c of cats || []) rows.appendChild(catRow(c));
}

$("add-cat-btn").addEventListener("click", () => $("cat-rows").appendChild(catRow()));
$("default-cat-btn").addEventListener("click", () => fillCatRows(DEFAULT_PHOTO_CATEGORIES));

function editType(id) {
  const t = state.typesById.get(id);
  if (!t) return;
  state.editingTypeId = id;
  $("type-form-title").textContent = `Editar tipo: ${t.name}`;
  $("t-name").value = t.name || "";
  $("t-class").value = t.equipment_class || "";
  $("t-desc").value = t.description || "";
  $("t-active").value = t.active === false ? "" : "1";
  const rows = $("attr-rows");
  rows.innerHTML = "";
  for (const a of t.attributes || []) rows.appendChild(attrRow(a));
  fillCatRows(t.photo_categories || []);
  msg("types-msg", "");
}

$("new-type-btn").addEventListener("click", () => startWizard("tipo"));

$("add-attr-btn").addEventListener("click", () => $("attr-rows").appendChild(attrRow()));

$("type-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.editingTypeId) {
    msg("types-msg", "Usa «+ Nuevo tipo» para crear un tipo con el asistente.", "warn");
    return;
  }
  const payload = {
    name: $("t-name").value.trim(),
    equipment_class: $("t-class").value.trim() || null,
    description: $("t-desc").value.trim() || null,
    active: $("t-active").value === "1",
    attributes: readAttrRows().filter((a) => a.key),
    photo_categories: readCatRows(),
  };
  try {
    await api(`/admin/asset-types/${encodeURIComponent(state.editingTypeId)}`, { method: "PUT", body: JSON.stringify(payload) });
    msg("types-msg", "Tipo actualizado.", "ok");
    await loadTypes();
  } catch (err) {
    msg("types-msg", err.message, "danger");
  }
});

// ---------------------------------------------------------------------------
// Activos
// ---------------------------------------------------------------------------

function fillStatusSelects() {
  $("a-status").innerHTML =
    '<option value="">Todos</option>' +
    Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("a-verif").innerHTML =
    '<option value="">Todos</option>' +
    Object.entries(VERIFICATION_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("st-status").innerHTML = Object.entries(STATUS_LABELS)
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join("");
}

async function loadBatches() {
  const batches = await api("/admin/import-batches").catch(() => []);
  $("a-batch").innerHTML =
    '<option value="">Todos</option>' +
    batches.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.filename || b.id)}</option>`).join("");
  renderBatches(batches);
}

function assetQuery() {
  const p = new URLSearchParams();
  if ($("a-q").value.trim()) p.set("q", $("a-q").value.trim());
  if ($("a-status").value) p.set("status", $("a-status").value);
  if ($("a-type").value) p.set("asset_type_id", $("a-type").value);
  if ($("a-verif").value) p.set("verification_status", $("a-verif").value);
  if ($("a-batch").value) p.set("import_batch_id", $("a-batch").value);
  if ($("a-deleted").value) p.set("include_deleted", "true");
  p.set("limit", PAGE_SIZE);
  p.set("offset", state.page * PAGE_SIZE);
  return p.toString();
}

async function loadAssets() {
  msg("assets-msg", "");
  try {
    const data = await api(`/admin/assets?${assetQuery()}`);
    state.total = data.total;
    renderAssets(data.items);
  } catch (err) {
    msg("assets-msg", err.message, "danger");
  }
}

function renderAssets(items) {
  const tbody = $("assets-tbody");
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="of-empty">Sin activos con estos filtros.</td></tr>';
  } else {
    tbody.innerHTML = items
      .map((a) => {
        const meta = a._meta || {};
        const tags = (meta.tags || []).map(escapeHtml).join(", ");
        const typeName = state.typesById.get(a.asset_type_id)?.name || a.asset_type_id || "—";
        const deleted = meta.deleted_at ? " of-deleted" : "";
        return `<tr class="${deleted.trim()}">
          <td><a href="/assets/${encodeURIComponent(a.id)}">${escapeHtml(a.name || a.id)}</a>
            <div class="of-popup-id">${escapeHtml(a.id)}${a.data_source ? ` · ${DATA_SOURCE_LABELS[a.data_source] || a.data_source}` : ""}</div></td>
          <td>${tags || "—"}</td>
          <td>${escapeHtml(typeName)}</td>
          <td>${statusBadge(a.status)}</td>
          <td>${verificationBadge(a.verification_status)}</td>
          <td><span class="of-row-actions">
            ${meta.deleted_at
              ? `<button type="button" class="of-btn" data-act="restore" data-id="${escapeHtml(a.id)}">Restaurar</button>`
              : `<button type="button" class="of-btn" data-act="edit" data-id="${escapeHtml(a.id)}">Editar</button>
                 <button type="button" class="of-btn" data-act="status" data-id="${escapeHtml(a.id)}">Estado</button>
                 <button type="button" class="of-btn" data-act="delete" data-id="${escapeHtml(a.id)}">Eliminar</button>`}
          </span></td>
        </tr>`;
      })
      .join("");
  }
  tbody.querySelectorAll("[data-act]").forEach((b) =>
    b.addEventListener("click", () => assetAction(b.dataset.act, b.dataset.id)),
  );
  const from = state.page * PAGE_SIZE + 1;
  const to = Math.min(state.total, (state.page + 1) * PAGE_SIZE);
  $("assets-page-info").textContent = state.total ? `${from}–${to} de ${state.total}` : "";
  $("assets-prev").disabled = state.page === 0;
  $("assets-next").disabled = to >= state.total;
}

async function assetAction(act, id) {
  if (act === "edit") return openAssetDialog(id);
  if (act === "status") {
    state.statusAssetId = id;
    $("status-form").reset();
    msg("status-form-msg", "");
    $("status-dialog").showModal();
    return;
  }
  if (act === "delete") {
    const reason = prompt(`Motivo para eliminar ${id}:`);
    if (reason === null) return;
    try {
      await api(`/assets/${encodeURIComponent(id)}?reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
      loadAssets();
    } catch (err) {
      alert(err.message);
    }
    return;
  }
  if (act === "restore") {
    try {
      await api(`/documents/${encodeURIComponent(id)}/restore`, { method: "POST" });
      loadAssets();
    } catch (err) {
      alert(err.message);
    }
  }
}

// ---- Formulario de activo ---------------------------------------------------

function attrInput(a, value) {
  const v = value ?? "";
  if (a.type === "select") {
    return `<select data-attr="${escapeHtml(a.key)}">
      <option value="">—</option>
      ${(a.options || []).map((o) => `<option ${String(v) === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
    </select>`;
  }
  if (a.type === "boolean") {
    return `<select data-attr="${escapeHtml(a.key)}">
      <option value="">—</option>
      <option value="true" ${v === true ? "selected" : ""}>Sí</option>
      <option value="false" ${v === false ? "selected" : ""}>No</option>
    </select>`;
  }
  if (a.type === "number") {
    return `<input data-attr="${escapeHtml(a.key)}" type="number" inputmode="decimal" step="any" value="${escapeHtml(String(v))}">`;
  }
  if (a.type === "date") {
    return `<input data-attr="${escapeHtml(a.key)}" type="date" value="${escapeHtml(String(v))}">`;
  }
  return `<input data-attr="${escapeHtml(a.key)}" type="text" maxlength="2000" value="${escapeHtml(String(v))}">`;
}

function renderAssetAttrInputs(typeDoc, values = {}) {
  const box = $("asset-attrs");
  const attrs = (typeDoc?.attributes || []).filter((a) => a.active !== false);
  if (!typeDoc || !attrs.length) {
    box.innerHTML = '<p class="of-progress-legend">Sin tipo o sin atributos configurados.</p>';
    return;
  }
  box.innerHTML = attrs
    .sort((x, y) => (x.order || 0) - (y.order || 0))
    .map(
      (a) => `<div class="of-field" style="margin-bottom:var(--of-space-2)">
        <label>${escapeHtml(a.label)}${a.unit ? ` (${escapeHtml(a.unit)})` : ""}${a.required ? " *" : ""}</label>
        ${attrInput(a, values[a.key])}
      </div>`,
    )
    .join("");
}

function readAssetAttrs() {
  const typeDoc = state.typesById.get($("f-asset-type").value);
  const defs = new Map((typeDoc?.attributes || []).map((a) => [a.key, a]));
  const out = {};
  $("asset-attrs").querySelectorAll("[data-attr]").forEach((el) => {
    const key = el.dataset.attr;
    const def = defs.get(key);
    if (!def) return;
    let v = el.value;
    if (v === "") { out[key] = null; return; }
    if (def.type === "boolean") v = v === "true";
    else if (def.type === "number") v = v.includes(",") ? parseFloat(v.replace(",", ".")) : parseFloat(v);
    out[key] = v;
  });
  return out;
}

$("f-asset-type").addEventListener("change", () => {
  renderAssetAttrInputs(state.typesById.get($("f-asset-type").value));
});

function openAssetDialog(id = null) {
  state.editingAssetId = id;
  $("asset-form").reset();
  $("asset-form-msg").textContent = "";
  $("asset-dialog-title").textContent = id ? "Editar activo" : "Enrolar activo";
  $("f-asset-tag").disabled = Boolean(id);
  $("f-asset-status").closest(".of-field").style.display = id ? "none" : "";
  if (id) {
    fetch(`/assets/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("activo no encontrado");
        return res.json();
      })
      .then((dossier) => {
        fillAssetDialog(dossier.asset);
        $("asset-dialog").showModal();
      })
      .catch((e) => alert(e.message));
  } else {
    renderAssetAttrInputs(null);
    $("asset-dialog").showModal();
  }
}

// Resuelve un "padre" escrito como TAG (resolve) o como id de activo (expediente).
async function resolveParent(value) {
  const v = value.trim();
  if (!v) return null;
  const match = await api(`/resolve?value=${encodeURIComponent(v)}`).catch(() => []);
  if (match[0]?.asset_id) return match[0].asset_id;
  const res = await fetch(`/assets/${encodeURIComponent(v)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (res.ok) return (await res.json()).asset.id;
  return null;
}

function fillAssetDialog(a) {
  $("f-asset-name").value = a.name || "";
  $("f-asset-type").value = a.asset_type_id || "";
  $("f-asset-tag").value = "";
  $("f-asset-crit").value = a.criticality || "";
  $("f-asset-loc").value = a.functional_location || "";
  $("f-asset-parent").value = a.parent_id || "";
  $("f-asset-mfr").value = a.manufacturer || "";
  $("f-asset-model").value = a.model || "";
  $("f-asset-serial").value = a.serial_number || "";
  const coords = a.location?.coordinates || [];
  $("f-asset-lon").value = coords[0] ?? "";
  $("f-asset-lat").value = coords[1] ?? "";
  renderAssetAttrInputs(state.typesById.get(a.asset_type_id), a.attributes || {});
}

$("new-asset-btn").addEventListener("click", () => startWizard("equipo"));
$("asset-cancel").addEventListener("click", () => $("asset-dialog").close());
$("status-cancel").addEventListener("click", () => $("status-dialog").close());

function numOrNull(id) {
  const v = $(id).value.trim();
  if (!v) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

$("asset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.editingAssetId) {
    msg("asset-form-msg", "Usa «+ Enrolar activo» para crear un activo con el asistente.", "warn");
    return;
  }
  const attrs = readAssetAttrs();
  const lon = numOrNull("f-asset-lon");
  const lat = numOrNull("f-asset-lat");
  try {
    const payload = {
      name: $("f-asset-name").value.trim(),
      asset_type_id: $("f-asset-type").value || null,
      criticality: $("f-asset-crit").value || null,
      functional_location: $("f-asset-loc").value.trim() || null,
      manufacturer: $("f-asset-mfr").value.trim() || null,
      model: $("f-asset-model").value.trim() || null,
      serial_number: $("f-asset-serial").value.trim() || null,
      attributes: attrs,
    };
    if (lon !== null || lat !== null) { payload.lon = lon; payload.lat = lat; }
    if ($("f-asset-parent").value.trim()) {
      payload.parent_id = await resolveParent($("f-asset-parent").value);
      if (!payload.parent_id) throw new Error("padre no encontrado (usa un TAG o un id de activo)");
    }
    await api(`/assets/${encodeURIComponent(state.editingAssetId)}`, { method: "PATCH", body: JSON.stringify(payload) });
    msg("asset-form-msg", "Activo actualizado.", "ok");
    $("asset-dialog").close();
    loadAssets();
  } catch (err) {
    msg("asset-form-msg", err.message, "danger");
  }
});

$("status-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("st-status").value;
  const reason = $("st-reason").value.trim() || null;
  if (["out_of_service", "decommissioned"].includes(status) && !reason) {
    msg("status-form-msg", "Este estado exige un motivo.", "danger");
    return;
  }
  if (status === "decommissioned" && !confirm("Desincorporar es un estado TERMINAL (no admite más cambios). ¿Continuar?")) return;
  try {
    await api(`/assets/${encodeURIComponent(state.statusAssetId)}/status`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    });
    $("status-dialog").close();
    loadAssets();
  } catch (err) {
    msg("status-form-msg", err.message, "danger");
  }
});

$("asset-filters").addEventListener("submit", (e) => { e.preventDefault(); state.page = 0; loadAssets(); });
$("assets-prev").addEventListener("click", () => { state.page = Math.max(0, state.page - 1); loadAssets(); });
$("assets-next").addEventListener("click", () => { state.page += 1; loadAssets(); });

// ---------------------------------------------------------------------------
// Importación CSV
// ---------------------------------------------------------------------------

async function runImport(dryRun) {
  const typeId = $("imp-type").value;
  const file = $("imp-file").files[0];
  if (!typeId) { msg("imp-msg", "Selecciona un tipo de activo.", "danger"); return null; }
  if (!file) { msg("imp-msg", "Selecciona un archivo CSV.", "danger"); return null; }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("asset_type_id", typeId);
  fd.append("dry_run", dryRun ? "true" : "false");
  msg("imp-msg", dryRun ? "Analizando…" : "Importando…");
  const res = await fetch("/admin/assets/import", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    msg("imp-msg", data.detail || `Error ${res.status}`, "danger");
    return null;
  }
  return data;
}

function renderReport(r) {
  const box = $("imp-report");
  const badge = (n, label) => `<span class="of-badge">${n} ${label}</span>`;
  let html = `<p>${badge(r.rows_total, "filas")} ${badge(r.created, "a crear")} ${badge(r.updated, "a actualizar")}
    ${badge(r.unchanged, "sin cambio")} ${badge(r.error_rows, "con error")} ${badge((r.conflicts || []).length, "conflictos")}</p>`;
  if (r.errors?.length) {
    html += `<h4>Errores</h4><table class="of-table"><thead><tr><th>Fila</th><th>Columna</th><th>Error</th></tr></thead><tbody>${
      r.errors.map((e) => `<tr><td>${e.row}</td><td>${escapeHtml(e.column || "")}</td><td>${escapeHtml(e.message)}</td></tr>`).join("")
    }</tbody></table>`;
  }
  if (r.conflicts?.length) {
    html += `<h4>Conflictos (atributo ya verificado; el CSV no lo pisa)</h4><table class="of-table"><thead><tr><th>Fila</th><th>Tag</th><th>Atributo</th><th>Valor actual</th><th>Valor CSV</th></tr></thead><tbody>${
      r.conflicts.map((c) => `<tr><td>${c.row}</td><td>${escapeHtml(c.tag || "")}</td><td>${escapeHtml(c.key)}</td><td>${escapeHtml(String(c.current_value))}</td><td>${escapeHtml(String(c.csv_value))}</td></tr>`).join("")
    }</tbody></table>`;
  }
  if (r.warnings?.length) {
    html += `<p class="of-progress-legend">${r.warnings.map((w) => `Columna «${escapeHtml(w.column)}» ignorada`).join(" · ")}</p>`;
  }
  box.innerHTML = html;
}

$("imp-preview").addEventListener("click", async () => {
  const r = await runImport(true);
  if (!r) return;
  renderReport(r);
  state.previewOk = r.created + r.updated > 0;
  $("imp-commit").disabled = !state.previewOk;
  msg("imp-msg", `Vista previa: ${r.created} a crear, ${r.updated} a actualizar, ${r.error_rows} con error.`, r.error_rows ? "warn" : "ok");
});

$("imp-commit").addEventListener("click", async () => {
  if (!state.previewOk) return;
  if (!confirm("¿Confirmar importación? Las filas con error se omitirán.")) return;
  const r = await runImport(false);
  if (!r) return;
  renderReport(r);
  $("imp-commit").disabled = true;
  state.previewOk = false;
  msg("imp-msg", `Importado: ${r.created} creados, ${r.updated} actualizados (lote ${r.batch_id}).`, "ok");
  loadBatches();
  loadAssets();
});

function renderBatches(batches) {
  const tbody = $("batches-tbody");
  if (!batches.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="of-empty">Sin importaciones todavía.</td></tr>';
    return;
  }
  tbody.innerHTML = batches
    .map((b) => {
      const p = b.progress || {};
      const pct = p.total ? Math.round((100 * p.verified) / p.total) : 0;
      return `<tr>
        <td class="of-popup-id">${escapeHtml(b.id)}</td>
        <td>${escapeHtml(b.filename || "—")}</td>
        <td>${b.rows_total}</td><td>${b.created}</td><td>${b.updated}</td><td>${b.errors}</td>
        <td><progress class="of-progress" max="100" value="${pct}"></progress>
          <span class="of-progress-legend">${p.verified || 0}/${p.total || 0} verificados</span></td>
        <td><a href="#assets" class="of-btn" data-batch="${escapeHtml(b.id)}" style="text-decoration:none">ver activos</a></td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll("[data-batch]").forEach((el) =>
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      $("a-batch").value = el.dataset.batch;
      location.hash = "assets";
      showTab("assets");
      state.page = 0;
      loadAssets();
    }),
  );
}

// ---------------------------------------------------------------------------
// Estados (tabla informativa)
// ---------------------------------------------------------------------------

function renderStates() {
  const rules = {
    planned: "Registrado, aún no en servicio.",
    in_service: "En servicio (estado por defecto al enrolar).",
    standby: "Disponible pero fuera de operación temporal.",
    out_of_service: "Fuera de servicio; exige motivo.",
    decommissioned: "Desincorporado; exige motivo y es TERMINAL (bloquea nuevas capturas).",
  };
  $("states-table").querySelector("tbody").innerHTML = Object.entries(STATUS_LABELS)
    .map(([k, v]) => `<tr><td><code>${k}</code></td><td>${statusBadge(k)} ${v}</td><td>${rules[k]}</td></tr>`)
    .join("");
  const scopes = {
    pending: "Activo y atributo",
    in_progress: "Activo",
    verified: "Activo",
    not_found: "Activo",
  };
  const attrScopes = { pending: "Atributo", confirmed: "Atributo", corrected: "Atributo", unverifiable: "Atributo" };
  $("verif-table").querySelector("tbody").innerHTML =
    Object.entries(VERIFICATION_LABELS)
      .map(([k, v]) => `<tr><td><code>${k}</code></td><td>${verificationBadge(k)} ${v}</td><td>${scopes[k]}</td></tr>`)
      .join("") +
    Object.entries(ATTR_VERIFICATION_LABELS)
      .map(([k, v]) => `<tr><td><code>${k}</code></td><td>${attrVerificationBadge(k)} ${v}</td><td>${attrScopes[k]}</td></tr>`)
      .join("");
}

// ---------------------------------------------------------------------------
// Wizards de alta (ADR-0025)
// ---------------------------------------------------------------------------

const localKv = createLocalKv();
let wizardCtx = null;

function currentTab() {
  const tab = (location.hash.replace("#", "") || "assets").split("?")[0];
  return ["assets", "types", "import", "states", "consents"].includes(tab) ? tab : "assets";
}

async function startWizard(kind) {
  const draft = await loadDraft(localKv, kind);
  if (draft && !confirm("Tienes un alta sin terminar. ¿Continuar donde la dejaste?")) {
    await clearDraft(localKv, kind);
    openWizard(kind, {});
    return;
  }
  openWizard(kind, draft ? { data: draft.data, stepId: draft.stepId } : {});
}

function openWizard(kind, { data = {}, stepId = null } = {}) {
  const def = WIZARDS[kind];
  const wiz = createWizard({ steps: def.steps(), data: def.initData(data), stepId });
  const root = $("wizard-root");
  root.hidden = false;
  const ui = mountWizard(root, wiz, {
    title: def.title,
    finishLabel: def.finishLabel,
    renderStep: def.renderStep,
    onFinish: (d) => def.onFinish(d, finishWizard),
    onClose: () => closeWizard(),
    onStepChange: (id, dir) => {
      saveDraft(localKv, kind, wiz);
      if (dir === "next") history.pushState({ wiz: kind, step: id }, "", `#wizard/${kind}/${id}`);
      else history.back();
    },
  });
  wizardCtx = { kind, wiz, ui };
  history.pushState({ wiz: kind, step: wiz.current().id }, "", `#wizard/${kind}/${wiz.current().id}`);
  ui.render();
}

function hideWizard() {
  const root = $("wizard-root");
  root.hidden = true;
  root.innerHTML = "";
  wizardCtx = null;
}

async function finishWizard() {
  if (wizardCtx) await clearDraft(localKv, wizardCtx.kind);
  hideWizard();
  history.replaceState({}, "", `#${currentTab()}`);
}

function closeWizard() {
  if (!wizardCtx) return;
  if (!confirm("¿Descartar el alta en curso? Se perderá lo escrito.")) return;
  clearDraft(localKv, wizardCtx.kind);
  if (history.state && history.state.wiz) history.back();
  else hideWizard();
}

window.addEventListener("popstate", (e) => {
  const st = e.state;
  if (!wizardCtx) {
    if (st && st.wiz) history.replaceState({}, "", `#${currentTab()}`);
    return;
  }
  if (st && st.wiz === wizardCtx.kind) {
    wizardCtx.wiz.goTo(st.step);
    wizardCtx.ui.render();
  } else {
    hideWizard();
  }
});

const EQUIPMENT_CLASSES = [
  "rotating/motor", "rotating/pump", "electrical/switchgear",
  "electrical/transformer", "instrumentation/sensor",
];

function parseAttrValue(def, raw) {
  if (raw === "" || raw == null) return null;
  if (def.type === "boolean") return raw === "true";
  if (def.type === "number") {
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) throw new Error(`"${def.label}" debe ser un número`);
    return n;
  }
  return raw;
}

const TIPO_WIZARD = {
  title: "Nuevo tipo de equipo",
  finishLabel: "Crear tipo",
  initData: (data) => ({
    name: "",
    equipment_class: "",
    description: "",
    attributes: [],
    photo_categories: DEFAULT_PHOTO_CATEGORIES.map((c) => ({ ...c })),
    pendingLabel: "",
    ...data,
  }),
  steps: () => [
    { id: "nombre", title: "¿Cómo se llama el tipo de equipo?", validate: (d) => (d.name && d.name.trim() ? null : "Escribe un nombre.") },
    { id: "clase", title: "Clase de equipo (opcional)" },
    { id: "descripcion", title: "Descripción (opcional)" },
    {
      id: "atributos",
      title: "Atributos de la ficha técnica",
      validate: (d) => {
        if (d.pendingLabel && d.pendingLabel.trim()) return "Agrega el atributo o borra la etiqueta.";
        const bad = (d.attributes || []).find((a) => a.type === "select" && !(a.options || []).length);
        return bad ? `El atributo "${bad.label}" es de tipo lista y necesita opciones.` : null;
      },
    },
    { id: "categorias", title: "Categorías de foto" },
    { id: "revision", title: "Revisa y crea", finishLabel: "Crear tipo" },
  ],
  renderStep(step, data, body, wiz, rerender) {
    if (step.id === "nombre") {
      body.innerHTML = `<div class="of-field"><label for="w-name">Nombre</label>
        <input id="w-name" maxlength="200" value="${escapeHtml(data.name || "")}" placeholder="p. ej. Motor eléctrico"></div>`;
      const el = body.querySelector("#w-name");
      el.addEventListener("input", () => wiz.set({ name: el.value }));
      el.focus();
      return;
    }
    if (step.id === "clase") {
      body.innerHTML = `<p class="of-status">Sugerencias de nomenclatura tipo ISO 14224 (puedes escribir otra).</p>
        ${EQUIPMENT_CLASSES.map((c) => `<button type="button" class="of-card-option${data.equipment_class === c ? " active" : ""}" data-c="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
        <div class="of-field"><label for="w-class">Otra clase</label>
          <input id="w-class" maxlength="100" value="${escapeHtml(data.equipment_class || "")}"></div>`;
      body.querySelectorAll("[data-c]").forEach((b) =>
        b.addEventListener("click", () => { wiz.set({ equipment_class: b.dataset.c }); rerender(); }));
      const el = body.querySelector("#w-class");
      el.addEventListener("input", () => wiz.set({ equipment_class: el.value }));
      return;
    }
    if (step.id === "descripcion") {
      body.innerHTML = `<div class="of-field"><label for="w-desc">Descripción</label>
        <textarea id="w-desc" rows="4" maxlength="2000">${escapeHtml(data.description || "")}</textarea></div>`;
      const el = body.querySelector("#w-desc");
      el.addEventListener("input", () => wiz.set({ description: el.value }));
      return;
    }
    if (step.id === "atributos") {
      const attrs = data.attributes || [];
      body.innerHTML = `
        <div>${attrs.map((a, i) => `<div class="of-field" style="display:flex; justify-content:space-between; align-items:center; gap:.5rem">
            <span><strong>${escapeHtml(a.label)}</strong> <code>${escapeHtml(a.key)}</code> · ${escapeHtml(a.type)}${a.unit ? ` (${escapeHtml(a.unit)})` : ""}${a.required ? " · obligatorio" : ""}</span>
            <button type="button" class="of-btn" data-del="${i}" title="Quitar">✕</button></div>`).join("") || '<p class="of-status">Aún no hay atributos. Puedes crear el tipo sin atributos.</p>'}</div>
        <div class="of-card" style="padding:var(--of-space-3); margin-top:var(--of-space-3)">
          <div class="of-field"><label for="w-a-label">Etiqueta</label><input id="w-a-label" maxlength="100" value="${escapeHtml(data.pendingLabel || "")}" placeholder="p. ej. Potencia nominal"></div>
          <div class="of-field"><label for="w-a-type">Tipo</label><select id="w-a-type">${ATTR_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></div>
          <div class="of-field" data-when="number"><label for="w-a-unit">Unidad</label><input id="w-a-unit" maxlength="20" placeholder="kW"></div>
          <div class="of-field" data-when="select" hidden><label for="w-a-options">Opciones (separadas por coma)</label><input id="w-a-options" maxlength="2000"></div>
          <label class="of-attr-flag"><input id="w-a-req" type="checkbox"> Obligatorio</label>
          <label class="of-attr-flag"><input id="w-a-ver" type="checkbox" checked> Verificar en terreno</label>
          <div class="of-actions"><button type="button" class="of-btn" id="w-a-add">+ Agregar atributo</button></div>
        </div>`;
      body.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", () => {
          const list = [...attrs];
          list.splice(Number(b.dataset.del), 1);
          wiz.set({ attributes: list });
          rerender();
        }));
      const label = body.querySelector("#w-a-label");
      const type = body.querySelector("#w-a-type");
      const unit = body.querySelector("#w-a-unit");
      const options = body.querySelector("#w-a-options");
      const sync = () => {
        body.querySelector('[data-when="number"]').hidden = type.value !== "number";
        body.querySelector('[data-when="select"]').hidden = type.value !== "select";
      };
      type.addEventListener("change", sync);
      label.addEventListener("input", () => wiz.set({ pendingLabel: label.value }));
      sync();
      body.querySelector("#w-a-add").addEventListener("click", () => {
        const text = label.value.trim();
        if (!text) { label.focus(); return; }
        const opts = options.value.split(",").map((s) => s.trim()).filter(Boolean);
        const attr = {
          key: toKey(text, attrs.map((a) => a.key)),
          label: text.slice(0, 100),
          type: type.value,
          unit: type.value === "number" ? (unit.value.trim() || null) : null,
          required: body.querySelector("#w-a-req").checked,
          options: type.value === "select" ? opts : null,
          active: true,
          order: attrs.length,
          verify_in_field: body.querySelector("#w-a-ver").checked,
        };
        wiz.set({ attributes: [...attrs, attr], pendingLabel: "" });
        rerender();
      });
      return;
    }
    if (step.id === "categorias") {
      const cats = data.photo_categories || [];
      body.innerHTML = `
        <p class="of-status">Etiquetas de un toque al confirmar cada foto. Si no dejas ninguna, la captura usa las predeterminadas.</p>
        <div>${cats.map((c, i) => `<label class="of-attr-flag" style="display:block; margin-bottom:.4rem">
            <input type="checkbox" data-cat="${i}" ${c.active !== false ? "checked" : ""}> ${escapeHtml(c.label)} <code>${escapeHtml(c.key)}</code></label>`).join("") || '<p class="of-status">Sin categorías configuradas.</p>'}</div>
        <div class="of-field"><label for="w-newcat">Otra categoría</label>
          <input id="w-newcat" maxlength="100" placeholder="p. ej. Rodamientos"></div>
        <div class="of-actions"><button type="button" class="of-btn" id="w-addcat">+ Agregar categoría</button></div>`;
      body.querySelectorAll("[data-cat]").forEach((el) =>
        el.addEventListener("change", () => {
          const list = cats.map((c, i) => (i === Number(el.dataset.cat) ? { ...c, active: el.checked } : c));
          wiz.set({ photo_categories: list });
        }));
      body.querySelector("#w-addcat").addEventListener("click", () => {
        const input = body.querySelector("#w-newcat");
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        const list = [...cats, { key: toKey(text, cats.map((c) => c.key)), label: text.slice(0, 100), active: true }];
        wiz.set({ photo_categories: list });
        rerender();
      });
      return;
    }
    if (step.id === "revision") {
      const attrs = data.attributes || [];
      const cats = (data.photo_categories || []).filter((c) => c.active !== false);
      body.innerHTML = `<div class="of-card">
        <p><strong>Nombre:</strong> ${escapeHtml(data.name)}</p>
        <p><strong>Clase:</strong> ${escapeHtml(data.equipment_class || "—")}</p>
        <p><strong>Descripción:</strong> ${escapeHtml(data.description || "—")}</p>
        <p><strong>Atributos (${attrs.length}):</strong> ${attrs.map((a) => escapeHtml(a.label)).join(", ") || "—"}</p>
        <p><strong>Categorías de foto:</strong> ${cats.map((c) => escapeHtml(c.label)).join(", ") || "predeterminadas"}</p>
      </div>`;
    }
  },
  async onFinish(data, done) {
    const payload = {
      name: data.name.trim(),
      equipment_class: data.equipment_class && data.equipment_class.trim() ? data.equipment_class.trim() : null,
      description: data.description && data.description.trim() ? data.description.trim() : null,
      active: true,
      attributes: (data.attributes || []).map((a, i) => ({ ...a, order: i })),
      photo_categories: (data.photo_categories || []).filter((c) => c.active !== false),
    };
    const doc = await api("/admin/asset-types", { method: "POST", body: JSON.stringify(payload) });
    await loadTypes();
    await done();
    editType(doc.id);
    msg("types-msg", `Tipo creado: ${doc.name}`, "ok");
  },
};

const EQUIPO_WIZARD = {
  title: "Enrolar activo",
  finishLabel: "Enrolar",
  initData: (data) => ({
    typeId: null,
    name: "",
    tag: "",
    functional_location: "",
    parent: "",
    lat: "",
    lon: "",
    attrs: {},
    manufacturer: "",
    model: "",
    serial_number: "",
    criticality: "",
    status: "in_service",
    ...data,
  }),
  steps: () => [
    { id: "tipo", title: "¿Qué tipo de equipo es?", validate: (d) => (d.typeId === null ? "Elige un tipo (o «Sin tipo»)." : null) },
    { id: "ident", title: "Identificación", validate: (d) => (d.name && d.name.trim() ? null : "Escribe un nombre.") },
    {
      id: "ubicacion",
      title: "Ubicación",
      validate: (d) => {
        const lat = String(d.lat || "").trim();
        const lon = String(d.lon || "").trim();
        return lat === lon || (lat && lon) ? null : "Latitud y longitud van juntas.";
      },
    },
    {
      id: "ficha",
      title: "Ficha técnica",
      skipIf: (d) => !d.typeId,
      validate: (d) => {
        const type = state.typesById.get(d.typeId);
        const missing = (type?.attributes || [])
          .filter((a) => a.active !== false && a.required)
          .filter((a) => {
            const v = (d.attrs || {})[a.key];
            return v === undefined || v === null || String(v).trim() === "";
          })
          .map((a) => a.label || a.key);
        return missing.length ? `Completa los obligatorios: ${missing.join(", ")}` : null;
      },
    },
    { id: "detalle", title: "Detalle" },
    { id: "estado", title: "Estado inicial" },
    { id: "revision", title: "Revisa y enrola", finishLabel: "Enrolar" },
  ],
  renderStep(step, data, body, wiz, rerender) {
    if (step.id === "tipo") {
      const types = state.types.filter((t) => t.active !== false);
      body.innerHTML = types.map((t) => `<button type="button" class="of-card-option${data.typeId === t.id ? " active" : ""}" data-t="${escapeHtml(t.id)}">${escapeHtml(t.name)}</button>`).join("")
        + `<button type="button" class="of-card-option${data.typeId === "" ? " active" : ""}" data-t="">Sin tipo</button>`;
      body.querySelectorAll("[data-t]").forEach((b) =>
        b.addEventListener("click", () => { wiz.set({ typeId: b.dataset.t }); rerender(); }));
      return;
    }
    if (step.id === "ident") {
      body.innerHTML = `<div class="of-field"><label for="w-aname">Nombre *</label>
          <input id="w-aname" maxlength="200" value="${escapeHtml(data.name || "")}"></div>
        <div class="of-field"><label for="w-atag">TAG</label>
          <input id="w-atag" maxlength="100" value="${escapeHtml(data.tag || "")}"></div>`;
      const name = body.querySelector("#w-aname");
      const tag = body.querySelector("#w-atag");
      name.addEventListener("input", () => wiz.set({ name: name.value }));
      tag.addEventListener("input", () => wiz.set({ tag: tag.value }));
      name.focus();
      return;
    }
    if (step.id === "ubicacion") {
      body.innerHTML = `<div class="of-field"><label for="w-aloc">Ubicación funcional</label>
          <input id="w-aloc" maxlength="200" value="${escapeHtml(data.functional_location || "")}"></div>
        <div class="of-field"><label for="w-aparent">Padre (TAG o id)</label>
          <input id="w-aparent" maxlength="100" value="${escapeHtml(data.parent || "")}"></div>
        <div class="of-field"><label for="w-alat">Latitud</label>
          <input id="w-alat" inputmode="decimal" maxlength="20" value="${escapeHtml(String(data.lat ?? ""))}"></div>
        <div class="of-field"><label for="w-alon">Longitud</label>
          <input id="w-alon" inputmode="decimal" maxlength="20" value="${escapeHtml(String(data.lon ?? ""))}"></div>`;
      const bind = (id, field) => {
        const el = body.querySelector(id);
        el.addEventListener("input", () => wiz.set({ [field]: el.value }));
      };
      bind("#w-aloc", "functional_location");
      bind("#w-aparent", "parent");
      bind("#w-alat", "lat");
      bind("#w-alon", "lon");
      return;
    }
    if (step.id === "ficha") {
      const type = state.typesById.get(data.typeId);
      const attrs = (type?.attributes || []).filter((a) => a.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
      body.innerHTML = attrs.map((a) => `<div class="of-field">
          <label>${escapeHtml(a.label)}${a.unit ? ` (${escapeHtml(a.unit)})` : ""}${a.required ? " *" : ""}</label>
          ${attrInput(a, (data.attrs || {})[a.key])}</div>`).join("")
        || '<p class="of-status">Este tipo no define atributos.</p>';
      body.querySelectorAll("[data-attr]").forEach((el) =>
        el.addEventListener("input", () => wiz.set({ attrs: { ...(data.attrs || {}), [el.dataset.attr]: el.value } })));
      body.querySelectorAll("select[data-attr]").forEach((el) =>
        el.addEventListener("change", () => wiz.set({ attrs: { ...(data.attrs || {}), [el.dataset.attr]: el.value } })));
      return;
    }
    if (step.id === "detalle") {
      body.innerHTML = `<div class="of-field"><label for="w-amfr">Fabricante</label><input id="w-amfr" maxlength="200" value="${escapeHtml(data.manufacturer || "")}"></div>
        <div class="of-field"><label for="w-amodel">Modelo</label><input id="w-amodel" maxlength="200" value="${escapeHtml(data.model || "")}"></div>
        <div class="of-field"><label for="w-aserial">N.º de serie</label><input id="w-aserial" maxlength="200" value="${escapeHtml(data.serial_number || "")}"></div>
        <div class="of-field"><label for="w-acrit">Criticidad</label>
          <select id="w-acrit"><option value="">—</option><option${data.criticality === "A" ? " selected" : ""}>A</option><option${data.criticality === "B" ? " selected" : ""}>B</option><option${data.criticality === "C" ? " selected" : ""}>C</option></select></div>`;
      const bind = (id, field) => {
        const el = body.querySelector(id);
        el.addEventListener("input", () => wiz.set({ [field]: el.value }));
        el.addEventListener("change", () => wiz.set({ [field]: el.value }));
      };
      bind("#w-amfr", "manufacturer");
      bind("#w-amodel", "model");
      bind("#w-aserial", "serial_number");
      bind("#w-acrit", "criticality");
      return;
    }
    if (step.id === "estado") {
      const opts = [["in_service", "En servicio"], ["planned", "Planificado"], ["standby", "En reserva"]];
      body.innerHTML = opts.map(([k, label]) =>
        `<button type="button" class="of-card-option${data.status === k ? " active" : ""}" data-s="${k}">${label}</button>`).join("");
      body.querySelectorAll("[data-s]").forEach((b) =>
        b.addEventListener("click", () => { wiz.set({ status: b.dataset.s }); rerender(); }));
      return;
    }
    if (step.id === "revision") {
      const type = state.typesById.get(data.typeId);
      const defs = (type?.attributes || []).filter((a) => a.active !== false);
      const filled = defs.filter((a) => {
        const v = (data.attrs || {})[a.key];
        return v !== undefined && v !== null && String(v).trim() !== "";
      }).map((a) => `${escapeHtml(a.label)}: ${escapeHtml(String(data.attrs[a.key]))}`);
      body.innerHTML = `<div class="of-card">
        <p><strong>Nombre:</strong> ${escapeHtml(data.name)}</p>
        <p><strong>Tipo:</strong> ${escapeHtml(type?.name || "sin tipo")}</p>
        <p><strong>TAG:</strong> ${escapeHtml(data.tag || "—")}</p>
        <p><strong>Ubicación:</strong> ${escapeHtml(data.functional_location || "—")}</p>
        <p><strong>Ficha:</strong> ${filled.join(" · ") || "—"}</p>
        <p><strong>Detalle:</strong> ${escapeHtml([data.manufacturer, data.model, data.serial_number].filter(Boolean).join(" ") || "—")}</p>
        <p><strong>Estado:</strong> ${escapeHtml(STATUS_LABELS[data.status] || data.status)}</p>
      </div>`;
    }
  },
  async onFinish(data, done) {
    const type = state.typesById.get(data.typeId);
    const defs = new Map((type?.attributes || []).map((a) => [a.key, a]));
    const attrs = {};
    for (const [key, raw] of Object.entries(data.attrs || {})) {
      const def = defs.get(key);
      if (!def) continue;
      const v = parseAttrValue(def, raw);
      if (v !== null) attrs[key] = v;
    }
    const lat = String(data.lat || "").trim();
    const lon = String(data.lon || "").trim();
    const payload = {
      name: data.name.trim(),
      asset_type_id: data.typeId || null,
      tag: data.tag && data.tag.trim() ? data.tag.trim() : null,
      criticality: data.criticality || null,
      functional_location: data.functional_location && data.functional_location.trim() ? data.functional_location.trim() : null,
      manufacturer: data.manufacturer && data.manufacturer.trim() ? data.manufacturer.trim() : null,
      model: data.model && data.model.trim() ? data.model.trim() : null,
      serial_number: data.serial_number && data.serial_number.trim() ? data.serial_number.trim() : null,
      status: data.status || "in_service",
      attributes: attrs,
      lon: lon ? Number(lon.replace(",", ".")) : null,
      lat: lat ? Number(lat.replace(",", ".")) : null,
    };
    if (data.parent && data.parent.trim()) {
      payload.parent_id = await resolveParent(data.parent);
      if (!payload.parent_id) throw new Error("padre no encontrado (usa un TAG o un id de activo)");
    }
    await api("/assets", { method: "POST", body: JSON.stringify(payload) });
    await loadAssets();
    await done();
    msg("assets-msg", "Activo enrolado.", "ok");
  },
};

const WIZARDS = { tipo: TIPO_WIZARD, equipo: EQUIPO_WIZARD };

// ---------------------------------------------------------------------------
// Consentimientos (solo lectura, ADR-0026)
// ---------------------------------------------------------------------------

async function loadConsents() {
  msg("consents-msg", "");
  const tbody = $("consents-tbody");
  try {
    const docs = await api("/documents?entity_type=consent-record&tenant_id=tenant-001");
    const rows = [...docs].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="of-empty">Sin registros de consentimiento.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((d) => `<tr>
        <td>${escapeHtml(formatDate(d.occurred_at))}</td>
        <td>${escapeHtml(d.subject?.display_name || d.subject?.id || "—")}
          <div class="of-popup-id">${escapeHtml(d.subject?.type || "")}</div></td>
        <td>${escapeHtml(d.device_id || "—")}</td>
        <td>${escapeHtml(`${d.policy_id || ""} v${d.policy_version || ""}`)}</td>
        <td>${d.action === "revoke" ? '<span class="of-badge danger">revocado</span>' : '<span class="of-badge ok">aceptado</span>'}</td>
        <td>${escapeHtml((d.scopes || []).join(", ") || "—")}</td>
        <td>${escapeHtml(d.expires_at ? formatDate(d.expires_at) : "—")}</td>
      </tr>`)
      .join("");
  } catch (err) {
    msg("consents-msg", err.message, "danger");
  }
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

async function init() {
  fillStatusSelects();
  renderStates();
  await loadTypes();
  await loadBatches();
  await loadAssets();
  const hash = location.hash.replace("#", "") || "assets";
  const [tab, query] = hash.split("?");
  showTab(["assets", "types", "import", "states", "consents"].includes(tab) ? tab : "assets");
  if (query) {
    const params = new URLSearchParams(query);
    if (params.get("batch")) { $("a-batch").value = params.get("batch"); loadAssets(); }
    if (params.get("id")) openAssetDialog(params.get("id"));
  }
}

init();
