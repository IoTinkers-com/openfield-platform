// Cola offline-first (D4). Fase 0: en memoria; Fase 1: IndexedDB (store.js).
// NOTA (ADR-0008): no usamos Background Sync (no existe en iOS); la sincronización
// es explícita cuando hay conexión.
import { newId, now } from "./ids.js";

// Sesión a la que pertenece un ítem de la cola (ADR-0027). null = grupo general.
export function sessionOf(item) {
  if (item.kind === "media") return item.doc?.session_id ?? null;
  if (item.kind === "audio" || item.kind === "session-end" || item.kind === "status") return item.session_id ?? null;
  if (item.kind === "verify") return item.payload?.session_id ?? null;
  if (item.kind === "doc") return item.doc?.session_id ?? (item.entity === "session" ? item.doc?.id ?? null : null);
  return null;
}

// session -> 0, capturas/documentos -> 1, session-end -> 2
const rank = (it) => (it.kind === "doc" && it.entity === "session" ? 0 : it.kind === "session-end" ? 2 : 1);

// Resumen por visita y borradores (ADR-0027).
export function summarize(items) {
  const out = { drafts: { total: 0, media: 0, audio: 0, notes: 0 }, general: 0, sessions: {} };
  const bucket = (it) => (it.kind === "media" ? "media"
    : it.kind === "audio" || (it.kind === "doc" && it.entity === "transcript") ? "audio"
      : it.kind === "doc" && it.entity === "observation" ? "notes"
        : it.kind === "verify" || it.kind === "status" ? "verify" : null);
  for (const it of items) {
    const b = bucket(it);
    if (it.draft) {
      out.drafts.total += 1;
      if (b && b in out.drafts) out.drafts[b] += 1;
      continue;
    }
    const sid = sessionOf(it);
    if (sid === null) {
      out.general += 1;
      continue;
    }
    const s = (out.sessions[sid] ||= { media: 0, audio: 0, notes: 0, verify: 0, total: 0 });
    s.total += 1;
    if (b) s[b] += 1;
  }
  return out;
}

export function createQueue() {
  const items = [];
  return {
    enqueue(item) {
      items.push(item);
      return item;
    },
    all() {
      return [...items];
    },
    async flush(syncFn) {
      const failed = [];
      for (const item of items) {
        try {
          await syncFn(item);
        } catch {
          failed.push(item); // reintentar más tarde
        }
      }
      items.length = 0;
      items.push(...failed);
      return { synced: items.length === 0 };
    },
  };
}

// Cola persistente (ADR-0023): cada ítem queda en el object store "queue".
// kind: "doc" | "media" | "audio" | "verify" | "session-end".
export function createPersistentQueue(store) {
  async function enqueue(item) {
    const entry = {
      ...item,
      qid: newId("q"),
      created_at: now(),
      attempts: 0,
      last_error: null,
    };
    await store.put("queue", entry);
    return entry;
  }

  async function list() {
    const items = await store.getAll("queue");
    items.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    return items;
  }

  async function update(qid, patch) {
    const item = await store.get("queue", qid);
    if (!item) return null;
    const merged = { ...item, ...patch, qid }; // qid no cambia
    await store.put("queue", merged);
    return merged;
  }

  async function remove(qid) {
    await store.delete("queue", qid);
  }

  async function count() {
    return (await store.getAll("queue")).length;
  }

  async function flush(syncFn) {
    const items = (await list()).filter((i) => !i.draft); // los borradores no se envían (ADR-0027)
    let synced = 0;
    let failed = 0;
    for (const item of items) {
      try {
        await syncFn(item);
        await remove(item.qid);
        synced += 1;
      } catch (e) {
        failed += 1;
        const msg = String((e && e.message) || e).slice(0, 300);
        await update(item.qid, { attempts: (item.attempts || 0) + 1, last_error: msg });
      }
    }
    return { synced, failed };
  }

  // Envío por visita (ADR-0027): general primero, luego cada visita en orden
  // session -> capturas y documentos -> session-end. Un fallo no impide el resto.
  async function flushBySession(syncFn, sessionIds = []) {
    const ready = (await list()).filter((i) => !i.draft);
    const result = { synced: 0, failed: 0, general: { synced: 0, failed: 0 }, sessions: {} };

    async function run(items, target) {
      for (const item of items) {
        try {
          await syncFn(item);
          await remove(item.qid);
          target.synced += 1;
        } catch (e) {
          target.failed += 1;
          const msg = String((e && e.message) || e).slice(0, 300);
          target.last_error = msg;
          await update(item.qid, { attempts: (item.attempts || 0) + 1, last_error: msg });
        }
      }
      result.synced += target.synced;
      result.failed += target.failed;
    }

    await run(ready.filter((i) => sessionOf(i) === null), result.general);
    for (const sid of sessionIds) {
      const target = (result.sessions[sid] = { synced: 0, failed: 0 });
      const items = ready
        .filter((i) => sessionOf(i) === sid)
        .sort((a, b) => rank(a) - rank(b) || (a.created_at < b.created_at ? -1 : 1));
      await run(items, target);
    }
    return result;
  }

  return { enqueue, list, update, remove, count, flush, flushBySession };
}
