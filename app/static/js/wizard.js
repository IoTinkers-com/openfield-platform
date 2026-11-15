// Motor de wizard (ADR-0025): pasos con saltos y validación, progreso n/m y borrador
// persistente. Sin DOM. Copias idénticas: wearable app/, platform static/pwa/ y static/js/.

export function toKey(label, taken = []) {
  let key = String(label || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) key = "campo";
  if (!/^[a-z]/.test(key)) key = `c_${key}`;
  key = key.slice(0, 50);
  let out = key;
  let i = 2;
  while (taken.includes(out)) {
    const suffix = `_${i++}`;
    out = key.slice(0, 50 - suffix.length) + suffix;
  }
  return out;
}

// steps: [{ id, title, skipIf?(data), validate?(data) -> string|null, finishLabel? }]
export function createWizard({ steps, data = {}, stepId = null } = {}) {
  const store = { ...data };
  const visible = () => steps.filter((s) => !(s.skipIf && s.skipIf(store)));
  let currentId = stepId && steps.some((s) => s.id === stepId) ? stepId : visible()[0].id;

  function normalize() {
    const vis = visible();
    if (vis.some((s) => s.id === currentId)) return;
    const orig = steps.findIndex((s) => s.id === currentId);
    const nextVisible = vis.find((s) => steps.indexOf(s) > orig);
    currentId = (nextVisible || vis[vis.length - 1]).id;
  }
  const current = () => { normalize(); return steps.find((s) => s.id === currentId); };
  const progress = () => {
    normalize();
    const vis = visible();
    return { n: vis.findIndex((s) => s.id === currentId) + 1, m: vis.length };
  };
  const error = () => { const s = current(); return (s.validate && s.validate(store)) || null; };

  return {
    get data() { return store; },
    current, progress, error,
    set(patch) { Object.assign(store, patch); normalize(); },
    next() {
      const err = error();
      if (err) return { ok: false, error: err };
      const vis = visible();
      const i = vis.findIndex((s) => s.id === currentId);
      if (i >= vis.length - 1) return { ok: true, done: true };
      currentId = vis[i + 1].id;
      return { ok: true, done: false, stepId: currentId };
    },
    back() {
      const vis = visible();
      const i = vis.findIndex((s) => s.id === currentId);
      if (i <= 0) return false;
      currentId = vis[i - 1].id;
      return true;
    },
    goTo(id) {
      if (!steps.some((s) => s.id === id)) return false;
      currentId = id;
      normalize();
      return true;
    },
    snapshot() { return { data: JSON.parse(JSON.stringify(store)), stepId: currentId }; },
  };
}

// Borrador persistente sobre un store con get/put/delete("kv") (store.js o createLocalKv).
export async function saveDraft(kv, wizardId, wiz) {
  await kv.put("kv", { key: `wizard.${wizardId}`, value: wiz.snapshot() });
}
export async function loadDraft(kv, wizardId) {
  const rec = await kv.get("kv", `wizard.${wizardId}`);
  return rec ? rec.value : null;
}
export async function clearDraft(kv, wizardId) {
  await kv.delete("kv", `wizard.${wizardId}`);
}

// Adaptador con la misma API que store.js para el panel admin (localStorage).
export function createLocalKv(storage = globalThis.localStorage) {
  return {
    async get(_table, key) {
      const raw = storage.getItem(`of.${key}`);
      return raw ? JSON.parse(raw) : null;
    },
    async put(_table, value) {
      storage.setItem(`of.${value.key}`, JSON.stringify(value));
      return value;
    },
    async delete(_table, key) {
      storage.removeItem(`of.${key}`);
    },
  };
}
