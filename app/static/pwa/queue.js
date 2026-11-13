// Cola offline-first (D4). Fase 0: en memoria; Fase 1: IndexedDB (store.js).
// NOTA (ADR-0008): no usamos Background Sync (no existe en iOS); la sincronización
// es explícita cuando hay conexión.
import { newId, now } from "./ids.js";

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
    const items = await list();
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

  return { enqueue, list, update, remove, count, flush };
}
