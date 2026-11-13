// Persistencia offline (D4 · ADR-0023): API asíncrona común sobre memoria e IndexedDB.
// Object stores: "queue" (keyPath "qid") y "kv" (keyPath "key").
//
// Los blobs NO se guardan como Blob directamente (el soporte de Blob en IndexedDB
// de Safari/iOS es inconsistente): se guardan como { buffer: ArrayBuffer, type }
// con blobToStored/storedToBlob.
//
// Copia idéntica en openfield-platform/app/static/pwa/store.js (ADR-0018).

export function createMemoryStore() {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const keyOf = (value) => value.qid ?? value.key;
  return {
    async put(storeName, value) {
      table(storeName).set(keyOf(value), value);
      return value;
    },
    async get(storeName, key) {
      return table(storeName).get(key) ?? null;
    },
    async getAll(storeName) {
      return [...table(storeName).values()];
    },
    async delete(storeName, key) {
      table(storeName).delete(key);
    },
  };
}

export function createIndexedDbStore({ name = "openfield", version = 1 } = {}) {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("queue")) {
          db.createObjectStore("queue", { keyPath: "qid" });
        }
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode, run) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const req = run(store);
      let result = req;
      if (req && typeof req === "object" && "onsuccess" in req) {
        req.onsuccess = () => {
          result = req.result;
        };
      }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    async put(storeName, value) {
      await tx(storeName, "readwrite", (s) => s.put(value));
      return value;
    },
    async get(storeName, key) {
      return (await tx(storeName, "readonly", (s) => s.get(key))) ?? null;
    },
    async getAll(storeName) {
      return (await tx(storeName, "readonly", (s) => s.getAll())) ?? [];
    },
    async delete(storeName, key) {
      await tx(storeName, "readwrite", (s) => s.delete(key));
    },
  };
}

export async function blobToStored(blob) {
  return { buffer: await blob.arrayBuffer(), type: blob.type || "" };
}

export function storedToBlob(stored) {
  if (!stored) return null;
  if (stored instanceof Blob) return stored; // ya es blob (p. ej. en tests)
  return new Blob([stored.buffer], { type: stored.type || "application/octet-stream" });
}
