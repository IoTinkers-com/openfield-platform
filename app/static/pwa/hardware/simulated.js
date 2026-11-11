// Implementación simulada de la capa de hardware (Fase 0, sin hardware real).
import { assertHardware } from "./interface.js";

export function simulatedHardware() {
  return assertHardware({
    capabilities() {
      return { thermal_level: "T0", gps: true, audio: true };
    },
    getLocation() {
      return { lon: -70.65, lat: -33.45 };
    },
    captureImage(seq = 1) {
      return { href: `https://picsum.photos/seed/wearable-${seq}/400/300` };
    },
    recordAudio() {
      // Fase 0: no hay audio real; se simula texto + motor (D7).
      return { href: null, text: "Registro de audio simulado" };
    },
  });
}
