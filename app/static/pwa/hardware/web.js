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

const AUDIO_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];

export function pickAudioMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (const m of AUDIO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
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

    // --- Cámaras (ADR-0023) ---
    // Las etiquetas solo están disponibles después de conceder el permiso;
    // sin permiso devolvemos "Cámara N".
    async listCameras() {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      return cams.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Cámara ${i + 1}`,
        groupId: d.groupId || null,
      }));
    },

    async openCamera({ deviceId = null, facingMode = "environment" } = {}) {
      const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facingMode } };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (e) {
        // Si el deviceId exacto falla, reintenta por orientación.
        if (deviceId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false });
        } else {
          throw e;
        }
      }
      const track = stream.getVideoTracks()[0];
      return {
        stream,
        settings: track?.getSettings ? track.getSettings() : {},
        label: track?.label || "",
      };
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

    // --- Nota de voz iniciar/detener libre (ADR-0023) ---
    async startAudioRecording({ maxMs = 300000, onTick } = {}) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks = [];
      const startedAt = Date.now();
      let autoStopped = false;
      let tickTimer = null;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.start(1000);

      const elapsed = () => Date.now() - startedAt;
      if (typeof onTick === "function") {
        tickTimer = setInterval(() => onTick(elapsed()), 250);
      }
      const maxTimer = setTimeout(() => {
        autoStopped = true;
        if (recorder.state !== "inactive") recorder.stop();
      }, maxMs);

      function cleanup() {
        clearTimeout(maxTimer);
        if (tickTimer) clearInterval(tickTimer);
        stream.getTracks().forEach((t) => t.stop());
      }

      return {
        async stop() {
          if (recorder.state !== "inactive") recorder.stop();
          await stopped;
          cleanup();
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
          return { blob, durationMs: elapsed(), mimeType: blob.type, autoStopped };
        },
        cancel() {
          if (recorder.state !== "inactive") recorder.stop();
          stopped.then(() => cleanup());
        },
      };
    },

    async recordAudio(durationMs = 3000) {
      // Compatibilidad con la firma anterior (duración fija).
      const rec = await this.startAudioRecording({ maxMs: durationMs });
      await new Promise((r) => setTimeout(r, durationMs));
      const out = await rec.stop();
      return { href: null, blob: out.blob, text: null, durationMs: out.durationMs, mimeType: out.mimeType };
    },
  });
}
