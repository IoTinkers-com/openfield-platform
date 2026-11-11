// Service worker mínimo.
// NOTA (ADR-0008): NO usamos Background Sync (no existe en iOS). La sincronización
// offline-first es explícita, no en segundo plano.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
