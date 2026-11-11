// Implementación web real de la capa de hardware (Fase 1).
// Solo funciona en el navegador (getUserMedia, Geolocation, MediaRecorder).
import { assertHardware } from "./interface.js";

function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function webHardware() {
  return assertHardware({
    capabilities() {
      return {
        thermal_level: null, // sin térmica en la web (T0 = imagen normal)
        gps: "geolocation" in navigator,
        audio: Boolean(navigator.mediaDevices?.getUserMedia),
      };
    },
    async getLocation() {
      if (!("geolocation" in navigator)) return null;
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy }),
          () => resolve(null),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
        );
      });
    },
    async captureImage(videoEl) {
      // Reusa el stream del preview (no abre una segunda cámara).
      if (!videoEl || !videoEl.videoWidth) throw new Error("cámara no iniciada");
      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      canvas.getContext("2d").drawImage(videoEl, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      const href = await dataUrlFromBlob(blob);
      return { href, blob };
    },
    async recordAudio(durationMs = 3000) {
      // Duración configurable. La transcripción local (Whisper WASM por validar, ADR-0008)
      // se reserva para una fase posterior; hoy transcribe el backend.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      await new Promise((r) => setTimeout(r, durationMs));
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      return { href: null, blob: new Blob(chunks, { type: "audio/webm" }), text: null };
    },
  });
}
