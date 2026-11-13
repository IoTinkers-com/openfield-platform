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
  for (const t of ["assets", "types", "import", "states"]) {
    $(`tab-${t}`).style.display = t === name ? "" : "none";
  }
  document.querySelectorAll(".of-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  if (name === "import") loadBatches();
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

$("new-type-btn").addEventListener("click", () => {
  state.editingTypeId = null;
  $("type-form-title").textContent = "Nuevo tipo de activo";
  $("type-form").reset();
  $("t-active").value = "1";
  $("attr-rows").innerHTML = "";
  fillCatRows([]);
  msg("types-msg", "");
});

$("add-attr-btn").addEventListener("click", () => $("attr-rows").appendChild(attrRow()));

$("type-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: $("t-name").value.trim(),
    equipment_class: $("t-class").value.trim() || null,
    description: $("t-desc").value.trim() || null,
    active: $("t-active").value === "1",
    attributes: readAttrRows().filter((a) => a.key),
    photo_categories: readCatRows(),
  };
  try {
    if (state.editingTypeId) {
      await api(`/admin/asset-types/${encodeURIComponent(state.editingTypeId)}`, { method: "PUT", body: JSON.stringify(payload) });
      msg("types-msg", "Tipo actualizado.", "ok");
    } else {
      const doc = await api("/admin/asset-types", { method: "POST", body: JSON.stringify(payload) });
      state.editingTypeId = doc.id;
      msg("types-msg", `Tipo creado: ${doc.id}`, "ok");
    }
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

$("new-asset-btn").addEventListener("click", () => openAssetDialog(null));
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
  const attrs = readAssetAttrs();
  const lon = numOrNull("f-asset-lon");
  const lat = numOrNull("f-asset-lat");
  try {
    if (!state.editingAssetId) {
      const payload = {
        name: $("f-asset-name").value.trim(),
        asset_type_id: $("f-asset-type").value || null,
        tag: $("f-asset-tag").value.trim() || null,
        criticality: $("f-asset-crit").value || null,
        functional_location: $("f-asset-loc").value.trim() || null,
        manufacturer: $("f-asset-mfr").value.trim() || null,
        model: $("f-asset-model").value.trim() || null,
        serial_number: $("f-asset-serial").value.trim() || null,
        status: $("f-asset-status").value,
        attributes: attrs,
        lon, lat,
      };
      if ($("f-asset-parent").value.trim()) {
        payload.parent_id = await resolveParent($("f-asset-parent").value);
        if (!payload.parent_id) throw new Error("padre no encontrado (usa un TAG o un id de activo)");
      }
      await api("/assets", { method: "POST", body: JSON.stringify(payload) });
      msg("asset-form-msg", "Activo enrolado.", "ok");
    } else {
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
    }
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
  showTab(["assets", "types", "import", "states"].includes(tab) ? tab : "assets");
  if (query) {
    const params = new URLSearchParams(query);
    if (params.get("batch")) { $("a-batch").value = params.get("batch"); loadAssets(); }
    if (params.get("id")) openAssetDialog(params.get("id"));
  }
}

init();
