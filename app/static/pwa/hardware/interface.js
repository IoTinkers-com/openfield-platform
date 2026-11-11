// Contrato de la capa de hardware (D8): desacoplada para PWA -> Capacitor/nativo.
//
// Toda implementación debe proveer:
//   capabilities() -> { thermal_level: "T0"|"T1"|"T2"|"T3"|null, gps: bool, audio: bool }
//   getLocation()  -> { lon, lat } | null
//   captureImage() -> { href }                       (Fase 0: marcador de posición)
//   recordAudio()  -> { href, text } | null          (text = transcripción simulada)
//
// En Fase 0 usamos `simulated.js`; en Fase 1 `web.js` (MediaDevices, Geolocation, etc.).

export const REQUIRED_METHODS = ["capabilities", "getLocation", "captureImage", "recordAudio"];

export function assertHardware(impl) {
  for (const method of REQUIRED_METHODS) {
    if (typeof impl[method] !== "function") {
      throw new Error(`implementación de hardware inválida: falta ${method}()`);
    }
  }
  return impl;
}
