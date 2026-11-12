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
  meta.innerHTML = `<div class="of-media-id">${escapeHtml(media.id)}</div><div>${formatDate(media.captured_at)}</div>`;
  card.appendChild(meta);
  return card;
}
