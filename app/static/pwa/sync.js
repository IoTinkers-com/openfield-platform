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

export async function transcribeAudio(blob, baseUrl = "") {
  const form = new FormData();
  form.append("file", blob, "audio.webm");
  const res = await fetch(`${baseUrl}/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`transcribe failed: ${res.status}`);
  return res.json(); // { text, engine }
}
