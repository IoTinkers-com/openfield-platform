// Utilidades compartidas entre las vistas de expediente (asset.html, session.html).
// Mismo espíritu que openfield.css (ADR-0018): sin framework de frontend (D8).

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function formatDate(value) {
  if (!value) return "—";
  return String(value).slice(0, 19).replace("T", " ");
}

export function emptyState(container, { icon = "🗂️", title, hint, cta } = {}) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "of-empty";
  wrap.innerHTML = `
    <div class="of-empty-icon">${icon}</div>
    <p><strong>${escapeHtml(title)}</strong></p>
    ${hint ? `<p>${escapeHtml(hint)}</p>` : ""}
  `;
  if (cta) {
    const a = document.createElement("a");
    a.className = "of-nav-link";
    a.href = cta.href;
    a.textContent = cta.label;
    wrap.appendChild(a);
  }
  container.appendChild(wrap);
}

export function mediaCard(media) {
  const card = document.createElement("a");
  card.className = "of-media-card";
  card.id = `media-${media.id}`;
  const href = media.assets && media.assets.primary && media.assets.primary.href;
  card.href = href || "#";
  card.target = href ? "_blank" : "_self";
  card.rel = "noopener";
  if (href && media.type === "image") {
    const img = document.createElement("img");
    img.src = href;
    img.alt = media.id;
    img.loading = "lazy";
    img.onerror = () => {
      const ph = document.createElement("div");
      ph.className = "of-media-placeholder";
      ph.textContent = "sin imagen";
      img.replaceWith(ph);
    };
    card.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "of-media-placeholder";
    ph.textContent = media.type === "audio" ? "🎙️ audio" : media.type === "thermal" ? "🌡️ térmica" : "sin imagen";
    card.appendChild(ph);
  }
  const meta = document.createElement("div");
  meta.className = "of-media-meta";
  const m = media.metadata || {};
  const caption = m.caption
    ? `<div class="of-media-caption">${escapeHtml(m.caption)}</div>`
    : "";
  const cat = m.category
    ? `<span class="of-badge">${escapeHtml(m.category_label || m.category)}</span>`
    : "";
  meta.innerHTML = `<div class="of-media-id">${escapeHtml(media.id)}</div><div>${formatDate(media.captured_at)}</div>${cat}${caption}`;
  card.appendChild(meta);
  return card;
}

// ---------------------------------------------------------------------------
// Edición, borrado lógico e historial de capturas (ADR-0021)
// ---------------------------------------------------------------------------

async function _json(res) {
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      detail = (await res.json()).detail || detail;
    } catch { /* respuesta sin JSON */ }
    throw new Error(detail);
  }
  return res.json();
}

export async function apiPatch(id, changes, reason) {
  const res = await fetch(`/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes, reason: reason || null }),
  });
  return _json(res);
}

export async function apiDelete(id, reason) {
  const res = await fetch(
    `/documents/${encodeURIComponent(id)}?reason=${encodeURIComponent(reason || "")}`,
    { method: "DELETE" },
  );
  return _json(res);
}

export async function apiRestore(id) {
  const res = await fetch(`/documents/${encodeURIComponent(id)}/restore`, { method: "POST" });
  return _json(res);
}

export async function apiHistory(id) {
  const res = await fetch(`/documents/${encodeURIComponent(id)}/history`, { cache: "no-store" });
  return _json(res);
}

export async function apiGetDoc(id) {
  const res = await fetch(`/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
  return _json(res);
}

export async function searchAssetsApi(q) {
  const res = await fetch(`/admin/assets?limit=50&q=${encodeURIComponent(q || "")}`, { cache: "no-store" });
  const data = await _json(res);
  return data.items || [];
}

export function renderHistory(tbody, revisions) {
  tbody.innerHTML = (revisions || [])
    .map((r) => `<tr>
      <td>${r.revision}</td>
      <td>${escapeHtml(r.action)}</td>
      <td>${escapeHtml(r.source || "")}</td>
      <td>${formatDate(r.created_at)}</td>
      <td>${escapeHtml(r.reason || "—")}</td>
      <td>${escapeHtml((r.changed_keys || []).join(", "))}</td>
    </tr>`)
    .join("") || `<tr><td colspan="6">Sin historial.</td></tr>`;
}

let _historyDialog = null;

export function showHistoryDialog(id) {
  if (!_historyDialog) {
    _historyDialog = document.createElement("dialog");
    _historyDialog.className = "of-card";
    _historyDialog.style.maxWidth = "40rem";
    _historyDialog.innerHTML = `
      <h3 class="of-section-title">Historial</h3>
      <div style="overflow-x:auto">
        <table class="of-table">
          <thead><tr><th>Rev.</th><th>Acción</th><th>Origen</th><th>Fecha</th><th>Motivo</th><th>Cambios</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="of-actions"><button class="of-btn" data-close>Cerrar</button></div>`;
    _historyDialog.querySelector("[data-close]").addEventListener("click", () => _historyDialog.close());
    document.body.appendChild(_historyDialog);
  }
  const tbody = _historyDialog.querySelector("tbody");
  tbody.innerHTML = `<tr><td colspan="6">Cargando…</td></tr>`;
  _historyDialog.showModal();
  apiHistory(id)
    .then((revs) => renderHistory(tbody, revs))
    .catch((e) => { tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(e.message)}</td></tr>`; });
}

// Botones de acción por ítem: ✎ editar · 🗑 eliminar · 🕘 historial
// (o solo Restaurar si el ítem está eliminado). `onChanged` recarga la vista.
export function itemActions({ id, kind, deleted = false, onEdit, onChanged }) {
  const wrap = document.createElement("span");
  wrap.className = "of-item-actions";
  wrap.style.cssText = "display:inline-flex; gap:0.3rem; vertical-align:middle";

  const mk = (label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "of-btn";
    b.style.cssText = "padding:0.15rem 0.45rem; font-size:0.85rem";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    return b;
  };

  const fail = (e) => alert("No se pudo completar la acción: " + e.message);

  if (deleted) {
    wrap.appendChild(mk("Restaurar", "Restaurar documento", async () => {
      try {
        await apiRestore(id);
        onChanged && onChanged();
      } catch (e) { fail(e); }
    }));
    return wrap;
  }

  if (onEdit) wrap.appendChild(mk("✎", "Editar", onEdit));
  wrap.appendChild(mk("🗑", "Eliminar", async () => {
    if (!confirm(`¿Eliminar ${kind} ${id}? (baja lógica, queda en el historial)`)) return;
    const reason = prompt("Motivo de la eliminación:", "");
    if (reason === null) return;
    try {
      await apiDelete(id, reason);
      onChanged && onChanged();
    } catch (e) { fail(e); }
  }));
  wrap.appendChild(mk("🕘", "Historial", () => showHistoryDialog(id)));
  return wrap;
}
