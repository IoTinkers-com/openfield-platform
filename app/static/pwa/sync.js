// Sincronización con la plataforma: subida de medios + ingesta de documentos.
// Nota: tus (subida reanudable) se agrega cuando haya medios grandes (video, D4).

export async function uploadMedia(blob, filename, baseUrl = "") {
  const form = new FormData();
  form.append("file", blob, filename);
  const res = await fetch(`${baseUrl}/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json(); // { href, filename, size }
}

export async function ingest(entityType, doc, baseUrl = "") {
  const res = await fetch(`${baseUrl}/ingest/${entityType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`ingest failed: ${res.status}`);
  return res.json();
}

export async function transcribeAudio(blob, baseUrl = "", { language = "es", filename } = {}) {
  const name = filename || (blob && blob.type && blob.type.includes("mp4") ? "audio.m4a" : "audio.webm");
  const form = new FormData();
  form.append("file", blob, name);
  const res = await fetch(`${baseUrl}/transcribe?language=${encodeURIComponent(language)}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`transcribe failed: ${res.status}`);
  return res.json(); // { text, engine }
}

export async function postVerify(assetId, payload, baseUrl = "") {
  const res = await fetch(`${baseUrl}/assets/${encodeURIComponent(assetId)}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`verify failed: ${res.status}`);
  return res.json();
}

export async function endSessionRemote(sessionId, endedAt, baseUrl = "") {
  const res = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ended_at: endedAt }),
  });
  if (!res.ok) throw new Error(`session-end failed: ${res.status}`);
  return res.json();
}
