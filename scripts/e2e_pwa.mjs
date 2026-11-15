// Arnés E2E de la PWA de captura: Chrome headless + DevTools Protocol.
// Hace clics reales en la interfaz y comprueba el estado contra la API.
// Uso: node _e2e.mjs   (requiere el servidor de pruebas en :8013)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { existsSync } from "node:fs";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error("No se encontró Chrome ni Edge. Define CHROME_PATH con la ruta del ejecutable.");
  process.exit(2);
}
const BASE = process.env.E2E_BASE || "http://localhost:8013";
const RUN = "E2E-" + Date.now();
const CAPTION = "Placa " + RUN;
const DEBUG_PORT = 9223;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout CDP ${method}`));
        }
      }, 30000);
    });
  }
  on(fn) { this.listeners.push(fn); }
}

async function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (e) => reject(new Error("WS error: " + e.message)));
  });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function main() {
  const profile = mkdtempSync(path.join(tmpdir(), "of-e2e-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=430,900",
    "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  const errors = [];
  const dialogs = [];
  try {
    // esperar el endpoint de depuración
    let version = null;
    for (let i = 0; i < 60 && !version; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
        version = await r.json();
      } catch { await sleep(250); }
    }
    if (!version) throw new Error("Chrome no expuso el puerto de depuración");
    cdp = new CDP(await wsConnect(version.webSocketDebuggerUrl));

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const sid = sessionId;

    cdp.on((msg) => {
      if (msg.method === "Page.javascriptDialogOpening") {
        dialogs.push(msg.params.message);
        cdp.send("Page.handleJavaScriptDialog", { accept: true }, sid).catch(() => {});
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        errors.push("excepción: " + (d.exception?.description || d.text));
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        errors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });

    await cdp.send("Runtime.enable", {}, sid);
    await cdp.send("Page.enable", {}, sid);
    // Captura de errores y rechazos dentro de la propia página.
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__errs = [];
        window.addEventListener("error", (e) => window.__errs.push("error: " + (e.message || e.error)));
        window.addEventListener("unhandledrejection", (e) => {
          const r = e.reason;
          window.__errs.push("rejection: " + (r && (r.stack || r.message) || r));
        });
      `,
    }, sid);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 2, mobile: true }, sid);
    await cdp.send("Emulation.setGeolocationOverride", { latitude: -33.45, longitude: -70.65, accuracy: 12 }, sid);
    try {
      await cdp.send("Browser.grantPermissions", {
        origin: BASE,
        permissions: ["geolocation", "videoCapture", "audioCapture"],
      });
    } catch (e) { errors.push("permisos: " + e.message); }

    const js = async (expr) => {
      const res = await cdp.send("Runtime.evaluate", {
        expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
      }, sid);
      if (res.exceptionDetails) {
        throw new Error("JS: " + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
      }
      return res.result.value;
    };
    const waitFor = async (expr, label, timeout = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const v = await js(`(() => { try { return (${expr}); } catch (e) { return false; } })()`);
        if (v) return v;
        await sleep(200);
      }
      throw new Error("timeout esperando: " + label);
    };
    const click = async (sel) => {
      const ok = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
      if (!ok) throw new Error("no existe el elemento " + sel);
      await sleep(150);
    };
    const fill = async (sel, value) => {
      const ok = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false;
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true; })()`);
      if (!ok) throw new Error("no existe el campo " + sel);
      await sleep(80);
    };
    const text = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent.trim() : null; })()`);
    const hash = () => js("location.hash");
    const nextStep = (scope) => click(`${scope ? scope + " " : ""}.of-wizard-bar [data-w="next"]`);
    const goto = async (h) => { await js(`location.hash = ${JSON.stringify(h)}; true`); await sleep(400); };

    // ---------------------------------------------------------------- arranque
    await cdp.send("Page.navigate", { url: BASE + "/capture/" }, sid);
    await waitFor("document.querySelector('#build') && document.querySelector('#build').textContent.includes('build e6.')", "build e6.2");
    await sleep(800);
    const bootHash = await js("location.hash");
    const bootState = await js("({ hash: location.hash, screen: document.querySelector('[data-screen=\\\"/inicio\\\"]')?.hidden, status: document.querySelector('#status')?.textContent })");
    console.log("   diagnóstico de arranque:", JSON.stringify(bootState));
    if (errors.length) console.log("   errores al cargar:", errors.slice(0, 5));
    check("la PWA carga con la build esperada", bootHash === "#/inicio", `hash=${bootHash}`);
    const header = await js(`(() => {
      const bar = document.querySelector('.of-topbar');
      const r = bar.getBoundingClientRect();
      return {
        overflow: bar.scrollWidth - bar.clientWidth,
        right: Math.round(r.right), vw: window.innerWidth,
        icons: document.querySelectorAll('.of-topnav .of-icon-btn').length,
        labels: [...document.querySelectorAll('.of-topnav .of-icon-btn')].every((a) => (a.getAttribute('aria-label') || '').length > 0),
      };
    })()`);
    check("la cabecera no se desborda en móvil", header.overflow <= 0 && header.right <= header.vw + 1, JSON.stringify(header));
    check("los accesos de la cabecera son iconos con etiqueta accesible", header.icons === 2 && header.labels, `${header.icons} icono(s)`);

    // ------------------------------------------------- consentimiento único
    await click("#home-capture");
    await waitFor("location.hash === '#/consentimiento'", "aviso de consentimiento");
    check("capturar sin consentimiento lleva al aviso", true);
    await click("#notice-ack");
    await click("#notice-accept");
    await waitFor("location.hash === '#/capturar'", "vuelta a capturar");
    check("aceptar el consentimiento vuelve a la captura", true);
    await goto("#/inicio");
    const consentHome = await text("#consent-state-home");
    check("Inicio muestra el consentimiento aceptado", /Aceptado|aceptado/.test(consentHome || ""), consentHome);

    // ------------------------------------------------------ captura sin equipo
    await click("#home-capture");
    await waitFor("location.hash === '#/capturar'", "pantalla capturar");
    await click("#cap-photo");
    await waitFor("location.hash === '#/camara'", "cámara");
    const videoOk = await waitFor("(() => { const v = document.querySelector('#preview'); return v && v.videoWidth > 0; })()", "stream de cámara");
    check("la cámara abre y entrega frames", Boolean(videoOk));
    const camLoadingHidden = await js("(() => { const el = document.querySelector('#cam-loading'); return !!el && getComputedStyle(el).display === 'none'; })()");
    check("el indicador de «abriendo cámara» desaparece al abrir", Boolean(camLoadingHidden));
    await click("#cam-shutter");
    await waitFor("location.hash === '#/camara/confirmar'", "confirmación");
    await fill("#conf-caption", CAPTION);
    const chips = await js("document.querySelectorAll('#conf-cats .of-chip').length");
    check("la confirmación ofrece categorías", chips >= 5, `${chips} chips`);
    await click('#conf-cats .of-chip[data-cat="placa"]');
    await click("#conf-use");
    await waitFor("location.hash === '#/camara'", "vuelta a cámara");
    check("«Usar foto» vuelve a la cámara", true);

    await goto("#/inicio");
    const trayVisible = await js("(() => { const el = document.querySelector('#home-tray'); return !!el && !el.hidden; })()");
    const trayLabel = await text("#home-tray");
    check("la bandeja aparece con la captura sin asignar", Boolean(trayVisible) && /1/.test(trayLabel || ""), trayLabel);

    // --------------------------------------- asignar a un equipo NUEVO (el bug)
    await click("#home-tray");
    await waitFor("location.hash === '#/bandeja'", "bandeja");
    await click("#tray-assign");
    await waitFor("location.hash === '#/asignar/capturas'", "wizard de asignación");
    await sleep(600);
    const asgDiag = await js(`({
      rootLen: (document.querySelector('#asignar-root')?.innerHTML || '').length,
      wizards: document.querySelectorAll('.of-wizard').length,
      bars: document.querySelectorAll('.of-wizard-bar').length,
      status: document.querySelector('#status')?.textContent,
      sectionHidden: document.querySelector('[data-screen="/asignar"]')?.hidden,
    })`);
    console.log("   diagnóstico asignación:", JSON.stringify(asgDiag));
    const pageErrs = await js("window.__errs || []");
    if (pageErrs.length) console.log("   errores en la página:", pageErrs.slice(-5));
    if (errors.length) console.log("   errores CDP:", errors.slice(-4));
    check("el wizard de asignación abre en el paso de capturas", asgDiag.wizards > 0, JSON.stringify(asgDiag));
    await nextStep("#asignar-root");
    await waitFor("location.hash === '#/asignar/equipo'", "paso equipo");
    await click("#asg-new");
    await waitFor("location.hash.startsWith('#/equipos/nuevo/')", "alta de equipo desde asignación");
    check("«+ Equipo nuevo» abre el alta guiada", true);

    // alta guiada: tipo -> identificación -> ficha -> revisión
    await waitFor("document.querySelectorAll('#na-root .of-card-option').length > 0", "tipos disponibles");
    await js("(() => { const b = [...document.querySelectorAll('#na-root .of-card-option')].find((x) => /Tablero/i.test(x.textContent)); (b || document.querySelector('#na-root .of-card-option')).click(); return true; })()");
    await sleep(200);
    await nextStep("#na-root");
    await sleep(500);
    const identDiag = await js(`({ hash: location.hash, err: document.querySelector('#na-root .of-wizard-body [data-w="error"]')?.textContent, rootLen: (document.querySelector('#na-root')?.innerHTML||'').length })`);
    if (!/ident/.test(identDiag.hash)) console.log("   diagnóstico paso tipo:", JSON.stringify(identDiag), "diálogos:", dialogs.slice(-3));
    await waitFor("location.hash === '#/equipos/nuevo/ident'", "paso identificación");
    await fill("#na-name", "Equipo " + RUN);
    await fill("#na-tag", RUN);
    await nextStep("#na-root");
    await waitFor("location.hash === '#/equipos/nuevo/ficha' || location.hash === '#/equipos/nuevo/revision'", "paso ficha");
    // completar el obligatorio si lo hay
    await js(`(() => {
      const req = document.querySelector("#na-root input[id^='na-']");
      if (req && !req.value) { req.value = "400"; req.dispatchEvent(new Event("input", { bubbles: true })); }
      return true;
    })()`);
    await nextStep("#na-root");
    await waitFor("location.hash === '#/equipos/nuevo/revision'", "paso revisión");
    await nextStep("#na-root"); // Enrolar
    await waitFor("location.hash === '#/asignar/equipo'", "retorno a la asignación", 25000);
    const selectedTxt = await text("#asignar-root");
    check("tras crear el equipo vuelve a la asignación con el equipo seleccionado", /Seleccionado:/.test(selectedTxt || ""), (selectedTxt || "").slice(0, 90));

    await nextStep("#asignar-root");
    await waitFor("location.hash === '#/asignar/confirmar'", "paso confirmar");
    await nextStep("#asignar-root"); // Asignar
    await waitFor("location.hash === '#/visita'", "visita abierta tras asignar", 25000);
    const visitTitle = await text("#asset-title");
    const visitCounts = await text("#visit-counts");
    check("la asignación abre la visita del equipo nuevo con la captura", /1 foto/.test(visitCounts || ""), `${visitTitle} · ${visitCounts}`);

    // ------------------------------------------------- cierre de visita
    await click("#end-session");
    await waitFor("location.hash === '#/visita/cerrar'", "resumen de cierre");
    const closeSummary = await text("#close-summary");
    check("el resumen de cierre muestra las capturas", /1 foto/.test(closeSummary || ""), (closeSummary || "").slice(0, 80));
    const closeLayout = await js(`(() => {
      const imgs = [...document.querySelectorAll('#close-thumbs img')];
      const widths = imgs.map((i) => Math.round(i.getBoundingClientRect().width));
      const btn = document.querySelector('#close-confirm')?.getBoundingClientRect();
      return {
        count: imgs.length,
        maxW: widths.length ? Math.max(...widths) : 0,
        btnTop: btn ? Math.round(btn.top) : -1,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    })()`);
    check("las miniaturas del cierre caben en la pantalla",
      closeLayout.maxW > 0 && closeLayout.maxW <= Math.ceil(closeLayout.vw / 2) + 4,
      JSON.stringify(closeLayout));
    check("el botón «Confirmar cierre» queda a la vista",
      closeLayout.btnTop >= 0 && closeLayout.btnTop < closeLayout.vh,
      `top=${closeLayout.btnTop} de ${closeLayout.vh}px`);
    await click("#close-confirm");
    await waitFor("location.hash === '#/visita/cerrada'", "visita cerrada");
    check("la visita se cierra y muestra el resumen", true);

    // ------------------------------------------------- sincronización
    await goto("#/sincronizar");
    await waitFor("document.querySelector('#sync-summary').textContent.length > 10", "resumen de sincronización");
    const syncSummary = await text("#sync-summary");
    check("el resumen indica una visita cerrada", /1 visita cerrada/.test(syncSummary || ""), syncSummary);
    // Observa el botón para comprobar que muestra progreso y luego lo retira.
    await js(`(() => {
      window.__spinSeen = 0;
      const b = document.querySelector('#sync-all');
      const obs = new MutationObserver(() => { if (b.querySelector('.of-spin')) window.__spinSeen += 1; });
      obs.observe(b, { childList: true, subtree: true, characterData: true });
      window.__spinObs = obs;
      return true;
    })()`);
    await click("#sync-all");
    let syncStatus = "";
    let syncOk = false;
    for (let i = 0; i < 120; i++) {
      syncStatus = (await text("#status")) || "";
      if (/Sincronizadas|no se pudieron sincronizar|Error al sincronizar|No había pendientes/.test(syncStatus)) {
        syncOk = /Sincronizadas/.test(syncStatus);
        break;
      }
      await sleep(300);
    }
    if (!syncOk) {
      const logText = (await text("#log")) || "";
      console.log("   log de sincronización:", logText.split("\n").slice(-6).join(" | "));
      const items = await js("(async () => { const q = await import('/capture/queue.js'); return 'n/a'; })()").catch(() => "n/a");
      void items;
    }
    check("la sincronización reporta éxito", syncOk, syncStatus);
    const spinSeen = await js("window.__spinSeen || 0");
    const spinLeft = await js("document.querySelectorAll('#sync-all .of-spin').length");
    check("el botón de sincronizar muestra progreso y lo retira", spinSeen > 0 && spinLeft === 0,
      `${spinSeen} aparición(es), ${spinLeft} restante(s)`);

    // comprobación contra la API
    const docs = await (await fetch(`${BASE}/documents?entity_type=media-item&tenant_id=tenant-001`)).json();
    const withCaption = docs.filter((d) => (d.metadata || {}).caption === CAPTION);
    check("la captura llegó a la plataforma con su leyenda", withCaption.length === 1, `${withCaption.length} medio(s)`);
    const assets = await (await fetch(`${BASE}/admin/assets?tenant_id=tenant-001&q=Equipo ${RUN}`)).json();
    check("el equipo nuevo existe en el registro", assets.total >= 1, `${assets.total} activo(s)`);

    await goto("#/inicio");
    const homeVisibility = await js(`(() => {
      const vis = (sel) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; };
      return { visit: vis('#home-visit'), tray: vis('#home-tray') };
    })()`);
    check("en Inicio los botones ocultos no se muestran (atributo hidden efectivo)",
      homeVisibility.visit === false && homeVisibility.tray === false, JSON.stringify(homeVisibility));

    // ---------------------------------------- escenario B: varias visitas + sync
    const openVisitAndCapture = async () => {
      await goto("#/inicio");
      await click("#go-assets");
      await waitFor("document.querySelectorAll('#asset-list [data-asset]').length > 0", "lista de equipos");
      await js("(() => { const b = document.querySelector('#asset-list [data-asset]'); b.click(); return true; })()");
      await waitFor("location.hash === '#/visita'", "visita abierta");
      const name = (await text("#asset-title")) || "";
      await click("#menu-photos");
      await waitFor("location.hash === '#/camara'", "cámara de la visita");
      await waitFor("(() => { const v = document.querySelector('#preview'); return v && v.videoWidth > 0; })()", "frames");
      await click("#cam-shutter");
      await waitFor("location.hash === '#/camara/confirmar'", "confirmación");
      await click("#conf-use");
      await waitFor("location.hash === '#/camara'", "vuelta a cámara");
      await goto("#/visita");
      await waitFor("location.hash === '#/visita'", "hub de visita");
      await click("#end-session");
      await waitFor("location.hash === '#/visita/cerrar'", "resumen");
      await click("#close-confirm");
      await waitFor("location.hash === '#/visita/cerrada'", "visita cerrada");
      return name;
    };

    const nameA = await openVisitAndCapture();
    const nameB = await openVisitAndCapture();
    await goto("#/sincronizar");
    await waitFor("document.querySelector('#sync-summary').textContent.length > 10", "resumen");
    const summary2 = await text("#sync-summary");
    check("dos visitas cerradas se resumen juntas", /2 visitas cerradas/.test(summary2 || ""), summary2);
    await click("#sync-all");
    let ok2 = false;
    let st2 = "";
    for (let i = 0; i < 150; i++) {
      st2 = (await text("#status")) || "";
      if (/Sincronizadas|Error al sincronizar|no se pudieron/.test(st2)) { ok2 = /Sincronizadas 2 de 2/.test(st2); break; }
      await sleep(300);
    }
    check("sincroniza varias visitas en una corrida", ok2, `${st2} (${nameA} / ${nameB})`);

    // ------------------------------------ escenario C: recarga con visita abierta
    await goto("#/inicio");
    await click("#go-assets");
    await waitFor("document.querySelectorAll('#asset-list [data-asset]').length > 0", "lista");
    await js("(() => { document.querySelector('#asset-list [data-asset]').click(); return true; })()");
    await waitFor("location.hash === '#/visita'", "visita abierta para recargar");
    const visitBefore = await text("#asset-title");
    await cdp.send("Page.reload", {}, sid);
    await waitFor("document.querySelector('#build') && document.querySelector('#build').textContent.includes('build e6.')", "recarga");
    // el arranque descarga el catálogo: esperar a que el hub de la visita se repueble
    const restored = await waitFor(
      "(() => { const t = document.querySelector('#asset-title'); return location.hash === '#/visita' && t && t.textContent.trim().length > 0; })()",
      "restauración de la visita",
      20000,
    ).catch(() => false);
    const afterReload = await js(`({
      title: document.querySelector('#asset-title')?.textContent?.trim() || '',
      counts: document.querySelector('#visit-counts')?.textContent || '',
      hash: location.hash,
    })`);
    check("la visita abierta sobrevive a la recarga", Boolean(restored) && /Visita iniciada/.test(afterReload.counts),
      `${afterReload.title} · ${afterReload.counts} (antes: ${visitBefore})`);

    // --------------------------------------------- escenario D: revocar consentimiento
    await goto("#/ajustes");
    await click("#consent-revoke");
    await sleep(400);
    await goto("#/inicio");
    await click("#home-capture");
    await waitFor("location.hash === '#/consentimiento'", "aviso tras revocar", 8000);
    check("revocar el consentimiento bloquea la captura", true);
    // restaurar para dejar la app usable
    await click("#notice-ack");
    await click("#notice-accept");
    await waitFor("location.hash === '#/capturar'", "consentimiento restaurado", 8000);
    check("se puede volver a aceptar el aviso", true);

    // ------------------------------------------- escenario F: cancelar visita
    await goto("#/inicio");
    await click("#go-assets");
    await waitFor("document.querySelectorAll('#asset-list [data-asset]').length > 0", "lista para cancelar");
    await js("(() => { document.querySelector('#asset-list [data-asset]').click(); return true; })()");
    await waitFor("location.hash === '#/visita'", "visita a cancelar");
    const sessionsBefore = (await (await fetch(`${BASE}/documents?entity_type=session&tenant_id=tenant-001`)).json()).length;
    await click("#menu-photos");
    await waitFor("location.hash === '#/camara'", "cámara antes de cancelar");
    await waitFor("(() => { const v = document.querySelector('#preview'); return v && v.videoWidth > 0; })()", "frames");
    await click("#cam-shutter");
    await waitFor("location.hash === '#/camara/confirmar'", "confirmación");
    await click("#conf-use");
    await waitFor("location.hash === '#/camara'", "vuelta a cámara");
    // verificación optimista que la cancelación debe revertir
    await goto("#/visita/verificar");
    await waitFor("document.querySelectorAll('#verify-form .va-confirm').length > 0", "atributos verificables");
    await js("(() => { const b = [...document.querySelectorAll('#verify-form .va-confirm')].find((x) => !x.disabled); if (b) b.click(); return true; })()");
    // el estado es parte de la ficha: se cambia con un selector y exige motivo
    await js(`(() => { const s = document.querySelector('#verify-status'); s.value = 'out_of_service'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(150);
    const reasonVisible = await js("(() => { const r = document.querySelector('#verify-status-reason'); return !!r && !r.hidden; })()");
    check("cambiar a fuera de servicio pide motivo", Boolean(reasonVisible));
    await fill("#verify-status-reason", "No arranca (E2E)");
    const saveLabel = await text("#save-verify");
    check("el botón resume los cambios pendientes", /estado: En servicio → Fuera de servicio/.test(saveLabel || ""), saveLabel);
    await click("#save-verify");
    await waitFor("/Encolado: .*estado → Fuera de servicio/.test(document.querySelector('#status').textContent)", "guardado con estado", 10000);
    check("guardar incluye el cambio de estado en el mismo paso", true);
    await goto("#/inspeccionar");
    await waitFor("document.querySelectorAll('#asset-list [data-asset]').length > 0", "lista con estado");
    const listOut = await text("#asset-list");
    check("el selector muestra el equipo fuera de servicio", /Fuera de servicio/.test(listOut || ""), (listOut || "").slice(0, 120));
    await goto("#/visita");
    const visitWithVerify = await text("#visit-counts");
    check("la visita registra la verificación antes de cancelar", /verificaci/.test(visitWithVerify || ""), visitWithVerify);
    await click("#visit-abort"); // el arnés acepta el confirm automáticamente
    await waitFor("location.hash === '#/inicio'", "inicio tras cancelar", 10000);
    const afterCancel = await js(`({
      status: document.querySelector('#status')?.textContent || '',
      tray: document.querySelector('#home-tray') ? !document.querySelector('#home-tray').hidden : false,
      visit: document.querySelector('#home-visit') ? !document.querySelector('#home-visit').hidden : false,
    })`);
    check("cancelar visita avisa y descarta los datos", /Visita cancelada/.test(afterCancel.status) && !afterCancel.tray && !afterCancel.visit, JSON.stringify(afterCancel));
    check("cancelar revierte la verificación optimista", /revirtieron 2 verificación/.test(afterCancel.status), afterCancel.status);
    await goto("#/inspeccionar");
    await waitFor("document.querySelectorAll('#asset-list [data-asset]').length > 0", "lista tras cancelar");
    const listAfterCancel = await text("#asset-list");
    check("el activo vuelve a mostrarse sin verificar y en servicio",
      /0% verificado|Pendiente/.test(listAfterCancel || "") && /En servicio/.test(listAfterCancel || ""),
      (listAfterCancel || "").slice(0, 120));
    await goto("#/sincronizar");
    await waitFor("document.querySelector('#sync-summary').textContent.length > 10", "resumen tras cancelar");
    const summaryCancel = await text("#sync-summary");
    check("la visita cancelada no queda en la cola de sincronización",
      /No hay visitas cerradas/.test(summaryCancel || "") && !/sin asignar/.test(summaryCancel || ""),
      summaryCancel);
    await sleep(1200);
    const sessionsAfter = (await (await fetch(`${BASE}/documents?entity_type=session&tenant_id=tenant-001`)).json()).length;
    check("la visita cancelada no se envió a la plataforma", sessionsAfter === sessionsBefore,
      `${sessionsBefore} -> ${sessionsAfter} sesiones`);

    // --------------------------------- escenario G: descartar capturas sin asignar
    const makeDraftPhoto = async () => {
      await goto("#/inicio");
      await click("#home-capture");
      await waitFor("location.hash === '#/capturar'", "capturar");
      await click("#cap-photo");
      await waitFor("location.hash === '#/camara'", "cámara");
      await waitFor("(() => { const v = document.querySelector('#preview'); return v && v.videoWidth > 0; })()", "frames");
      await click("#cam-shutter");
      await waitFor("location.hash === '#/camara/confirmar'", "confirmación");
      await click("#conf-use");
      await waitFor("location.hash === '#/camara'", "vuelta");
    };
    await makeDraftPhoto();
    await goto("#/inicio");
    await click("#home-capture");
    await click("#cap-text");
    await waitFor("location.hash === '#/texto'", "texto");
    await fill("#comment", "Comentario para descartar " + RUN);
    await click("#save-comment");
    await sleep(600);
    await goto("#/bandeja");
    await waitFor("document.querySelectorAll('#tray-list li').length === 2", "dos borradores en la bandeja");
    const trayButtons = await js(`(() => {
      const lis = [...document.querySelectorAll('#tray-list li')];
      return lis.map((li) => li.querySelectorAll('button').length);
    })()`);
    check("los borradores de la bandeja tienen acción de descartar", trayButtons.some((n) => n >= 2), JSON.stringify(trayButtons));
    const dialogsBefore = dialogs.length;
    await js(`(() => {
      const li = [...document.querySelectorAll('#tray-list li')].find((x) => /Comentario/.test(x.textContent));
      const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent.includes('🗑'));
      if (!b) return false;
      b.click();
      return true;
    })()`);
    await sleep(800);
    const warn = dialogs.slice(dialogsBefore).join(" | ");
    check("descartar una captura advierte que se pierde", /no se puede deshacer/.test(warn), warn.slice(0, 120));
    await waitFor("document.querySelectorAll('#tray-list li').length === 1", "un borrador tras descartar");
    check("el borrador descartado desaparece de la bandeja", true);
    await click("#tray-clear");
    await waitFor("document.querySelectorAll('#tray-list li').length === 0", "bandeja vacía", 10000);
    const trayInfo = await text("#tray-info");
    check("«Descartar todas» vacía la bandeja", /No hay capturas sin asignar/.test(trayInfo || ""), trayInfo);

    // ------------------------------------------- escenario E: wizard del panel admin
    await cdp.send("Page.navigate", { url: BASE + "/admin/" }, sid);
    await waitFor("document.querySelector('#new-type-btn')", "panel admin");
    await sleep(1200);
    const adminHeader = await js(`(() => {
      const bar = document.querySelector('.of-topbar');
      const r = bar.getBoundingClientRect();
      const icons = [...document.querySelectorAll('.of-topnav .of-icon-btn')];
      return {
        overflow: bar.scrollWidth - bar.clientWidth,
        right: Math.round(r.right), vw: window.innerWidth,
        icons: icons.length,
        svg: icons.every((a) => !!a.querySelector('svg')),
        labels: icons.every((a) => (a.getAttribute('aria-label') || '').length > 0),
      };
    })()`);
    check("la cabecera del panel usa iconos SVG y no se desborda",
      adminHeader.icons === 2 && adminHeader.svg && adminHeader.labels && adminHeader.overflow <= 0,
      JSON.stringify(adminHeader));
    await click("#new-type-btn");
    await waitFor("document.querySelector('#wizard-root .of-wizard')", "wizard de tipo");
    await fill("#w-name", "Tipo " + RUN);
    await click('#wizard-root .of-wizard-bar [data-w="next"]');
    await waitFor("document.querySelector('#w-class')", "paso clase");
    await click('#wizard-root .of-card-option');
    await click('#wizard-root .of-wizard-bar [data-w="next"]');
    await waitFor("document.querySelector('#w-desc')", "paso descripción");
    await click('#wizard-root .of-wizard-bar [data-w="next"]');
    await waitFor("document.querySelector('#w-a-label')", "paso atributos");
    await fill("#w-a-label", "Potencia");
    await js(`(() => { const s = document.querySelector('#w-a-type'); s.value = 'number'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await fill("#w-a-unit", "kW");
    await click("#w-a-add");
    await sleep(300);
    const attrAdded = await js("document.querySelectorAll('#wizard-root [data-del]').length");
    check("el wizard de tipo agrega atributos", attrAdded === 1, `${attrAdded} atributo(s)`);
    await click('#wizard-root .of-wizard-bar [data-w="next"]');
    await waitFor("document.querySelector('#w-addcat')", "paso categorías");
    await click('#wizard-root .of-wizard-bar [data-w="next"]');
    await waitFor("document.querySelector('#wizard-root .of-card')", "paso revisión");
    await click('#wizard-root .of-wizard-bar [data-w="next"]');
    await sleep(1500);
    const typeOk = await js(`fetch('/admin/asset-types?include_inactive=true').then(r => r.json()).then(l => l.some(t => t.name.startsWith('Tipo E2E-')))`);
    check("el tipo creado por el wizard queda en el registro", Boolean(typeOk));

    // ------------------------------------------------- errores de consola
    await goto("#/inicio");
    const stuck = await js("document.querySelectorAll('.of-spin').length");
    check("no queda ningún indicador de progreso colgado", stuck === 0, `${stuck} indicador(es)`);
    check("sin errores de JavaScript en la sesión", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    check("ejecución completa del guion", false, e.message);
    if (errors.length) {
      console.log("   errores capturados:");
      for (const err of errors.slice(0, 8)) console.log("   · " + err);
    }
  } finally {
    try { if (cdp) await cdp.send("Browser.close"); } catch { /* ignore */ }
    chrome.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
  if (failed.length) {
    console.log("FALLOS:");
    for (const f of failed) console.log(" - " + f.name + (f.detail ? ": " + f.detail : ""));
  }
  process.exit(failed.length ? 1 : 0);
}

main();
