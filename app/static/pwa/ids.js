// Identificadores y reloj (D4: offline-first).
// `crypto.randomUUID()` está disponible en navegadores y en Node >= 19.

export function newId(prefix = "id") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function now() {
  return new Date().toISOString();
}
