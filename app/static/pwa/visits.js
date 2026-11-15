// Visitas de captura (ADR-0027): 1 visita = 1 sesión = 1 equipo. Sin DOM.
// Copia idéntica en openfield-platform/app/static/pwa/visits.js (ADR-0018).
import { sessionOf } from "./queue.js";

export const STALE_MS = 12 * 3600 * 1000;

const mk = (session, asset) => ({
  id: session.id,
  session,
  asset_id: asset.id,
  asset_name: asset.name || asset.id,
  state: "open",
  started_at: session.started_at,
  ended_at: null,
});

export function openVisit(visits, { session, asset }) {
  if (visits.some((v) => v.state === "open")) throw new Error("ya hay una visita abierta");
  return [...visits, mk(session, asset)];
}

export function closeVisit(visits, id, endedAt) {
  const v = visits.find((x) => x.id === id);
  if (!v || v.state !== "open") throw new Error("la visita no está abierta");
  return visits.map((x) => (x.id === id ? { ...x, state: "closed", ended_at: endedAt } : x));
}

export function markSynced(visits, ids) {
  return visits.map((v) => (ids.includes(v.id) && v.state === "closed" ? { ...v, state: "synced" } : v));
}

export const currentVisit = (visits) => visits.find((v) => v.state === "open") || null;
export const closedVisits = (visits) => visits.filter((v) => v.state === "closed");

export function staleVisit(visits, nowIso, maxMs = STALE_MS) {
  const v = currentVisit(visits);
  return v && Date.parse(nowIso) - Date.parse(v.started_at) > maxMs ? v : null;
}

export function pruneSynced(visits, keep = 20) {
  const synced = visits.filter((v) => v.state === "synced").sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1));
  const drop = new Set(synced.slice(keep).map((v) => v.id));
  return visits.filter((v) => !drop.has(v.id));
}

// Borradores -> parches para queue.update. assetLocation es GeoJSON Point o null.
export function assignDrafts(items, visit, assetLocation = null) {
  return items.filter((i) => i.draft).map((it) => {
    if (it.kind === "media") {
      const doc = { ...it.doc, session_id: visit.id, asset_id: visit.asset_id };
      if (!doc.geometry && assetLocation) doc.geometry = assetLocation;
      return { qid: it.qid, patch: { draft: false, doc } };
    }
    if (it.kind === "audio") {
      return { qid: it.qid, patch: { draft: false, session_id: visit.id, asset_id: visit.asset_id } };
    }
    if (it.kind === "doc") {
      return { qid: it.qid, patch: { draft: false, doc: { ...it.doc, session_id: visit.id, asset_id: visit.asset_id } } };
    }
    return { qid: it.qid, patch: { draft: false } };
  });
}

function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearbyAssets(assets, fix, limit = 5) {
  if (!fix) return [];
  return assets
    .filter((a) => a.status !== "decommissioned" && a.location?.coordinates?.length === 2)
    .map((a) => ({
      asset: a,
      distance_m: haversine(fix.lon, fix.lat, a.location.coordinates[0], a.location.coordinates[1]),
    }))
    .sort((x, y) => x.distance_m - y.distance_m)
    .slice(0, limit);
}

// Migra sesiones de la Tanda D (ui.session + ítems de cola sin visita registrada).
export function legacyVisits(items, visits, { uiSession = null, assetsById = {}, nowIso = new Date().toISOString() } = {}) {
  const known = new Set(visits.map((v) => v.id));
  const out = [...visits];
  const ends = new Map(items.filter((i) => i.kind === "session-end").map((i) => [i.session_id, i.ended_at]));
  const docs = new Map(items.filter((i) => i.kind === "doc" && i.entity === "session").map((i) => [i.doc.id, i.doc]));
  const sids = new Set(items.map(sessionOf).filter(Boolean));
  if (uiSession && !uiSession.ended_at) sids.add(uiSession.id);
  for (const sid of sids) {
    if (known.has(sid)) continue;
    const session = docs.get(sid) || (uiSession && uiSession.id === sid ? uiSession : null);
    if (!session) continue;
    const open = Boolean(uiSession && uiSession.id === sid && !ends.has(sid));
    const asset = { id: session.asset_id, name: assetsById[session.asset_id]?.name };
    out.push({
      ...mk(session, asset),
      state: open ? "open" : "closed",
      ended_at: open ? null : (ends.get(sid) || nowIso),
    });
  }
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function describeCounts(c) {
  const parts = [];
  if (c.media) parts.push(plural(c.media, "foto", "fotos"));
  if (c.audio) parts.push(plural(c.audio, "nota de voz", "notas de voz"));
  if (c.verify) parts.push(plural(c.verify, "verificación", "verificaciones"));
  if (c.notes) parts.push(plural(c.notes, "comentario", "comentarios"));
  return parts.join(", ") || "sin capturas";
}

export function sumCounts(list) {
  return list.reduce(
    (a, c) => ({
      media: a.media + (c.media || 0),
      audio: a.audio + (c.audio || 0),
      verify: a.verify + (c.verify || 0),
      notes: a.notes + (c.notes || 0),
    }),
    { media: 0, audio: 0, verify: 0, notes: 0 },
  );
}
