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
      // ADR-0024: se pide resolución alta como "ideal" (nunca falla por restricción).
      const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      const video = deviceId
        ? { ...base, deviceId: { exact: deviceId } }
        : { ...base, facingMode: { ideal: facingMode } };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (e) {
        // Si el deviceId exacto falla, reintenta por orientación.
        if (deviceId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { ...base, facingMode: { ideal: facingMode } },
            audio: false,
          });
        } else {
          throw e;
        }
      }
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings ? track.getSettings() : {};
      const caps = track?.getCapabilities ? track.getCapabilities() : {};
      return {
        stream,
        track,
        settings,
        label: track?.label || "",
        capabilities: {
          torch: Boolean(caps.torch),
          zoom: caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step } : null,
        },
      };
    },

    // Controles en runtime: solo si getCapabilities los expone (ADR-0024).
    async setTorch(camera, on) {
      const track = camera?.track;
      if (!track?.applyConstraints || !camera?.capabilities?.torch) return false;
      await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
      return true;
    },

    async setZoom(camera, value) {
      const track = camera?.track;
      if (!track?.applyConstraints || !camera?.capabilities?.zoom) return false;
      await track.applyConstraints({ advanced: [{ zoom: Number(value) }] });
      return true;
    },

    // GPS continuo mientras la cámara está abierta (ADR-0024): el disparo usa
    // el último fix conocido en vez de esperar uno nuevo.
    watchLocation(onFix) {
      if (!("geolocation" in navigator) || typeof onFix !== "function") return () => {};
      const id = navigator.geolocation.watchPosition(
        (pos) => onFix({
          lon: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
        }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    },

    async captureImage(videoEl, { track = null } = {}) {
      // ADR-0024: ImageCapture.takePhoto() si está disponible (mejor resolución);
      // respaldo al canvas del preview.
      if (track && typeof ImageCapture !== "undefined") {
        try {
          const blob = await new ImageCapture(track).takePhoto();
          const href = await dataUrlFromBlob(blob);
          const bmp = typeof createImageBitmap === "function" ? await createImageBitmap(blob).catch(() => null) : null;
          return {
            href,
            blob,
            width: bmp?.width || videoEl?.videoWidth || 0,
            height: bmp?.height || videoEl?.videoHeight || 0,
          };
        } catch (_) { /* cae al canvas */ }
      }
      // Reusa el stream del preview (no abre una segunda cámara).
      if (!videoEl || !videoEl.videoWidth) throw new Error("cámara no iniciada");
      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      canvas.getContext("2d").drawImage(videoEl, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      const href = await dataUrlFromBlob(blob);
      return { href, blob, width: canvas.width, height: canvas.height };
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
