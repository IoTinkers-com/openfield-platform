// Enrutado por hash: una pantalla por paso (ADR-0024). El gesto/botón Atrás del
// sistema navega por el history API; cuando no hay historial dentro de la app,
// Atrás lleva a la pantalla padre de la ruta.
//
// routes: {"/inicio": HTMLElement, ...} — cada pantalla se muestra con `hidden`.
// guards: {"/ruta": () => "/redireccion" | null} — se evalúan en cada cambio.
// Copia idéntica en openfield-platform/app/static/pwa/router.js (ADR-0018).

export function normalizePath(hash, routes, fallback = "/inicio") {
  let p = (hash || "").replace(/^#/, "") || fallback;
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/+$/, "") || "/";
  return routes[p] ? p : fallback;
}

export function parentOf(path, fallback = "/inicio") {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : fallback;
}

export function createRouter({
  routes,
  defaultPath = "/inicio",
  guards = {},
  onShow = () => {},
  onLeave = () => {},
  win = window,
} = {}) {
  let current = null;
  let depth = 0; // entradas de historial creadas dentro de la app
  let expectPush = false;

  function resolve(path) {
    let p = path;
    for (let i = 0; i < 5; i++) {
      const redirect = guards[p] ? guards[p]() : null;
      if (!redirect || redirect === p) break;
      p = redirect;
    }
    return routes[p] ? p : defaultPath;
  }

  function show(path) {
    const prev = current;
    if (prev === path) return;
    if (prev) onLeave(prev, path);
    current = path;
    for (const [p, el] of Object.entries(routes)) {
      el.hidden = p !== path;
    }
    onShow(path, prev);
  }

  // Procesa el hash actual: resuelve guardas y muestra la pantalla.
  function sync() {
    const p = resolve(normalizePath(win.location.hash, routes, defaultPath));
    const want = `#${p}`;
    if (win.location.hash !== want) {
      // Guarda redirigió (o hash desconocido): reemplaza la entrada para que
      // Atrás no vuelva a la ruta rechazada.
      if (typeof win.location.replace === "function") win.location.replace(want);
      else win.location.hash = want;
      sync();
      return;
    }
    if (expectPush) {
      depth += 1;
      expectPush = false;
    } else if (current && current !== p) {
      depth = Math.max(0, depth - 1); // pop vía Atrás del sistema
    }
    show(p);
  }

  function navigate(path, { replace = false } = {}) {
    if (path === current && win.location.hash === `#${path}`) return;
    expectPush = !replace;
    if (replace && typeof win.location.replace === "function") win.location.replace(`#${path}`);
    else win.location.hash = `#${path}`;
    // El navegador dispara hashchange en async; sincronizar de inmediato hace
    // el mismo trabajo (el evento posterior resulta no-op) y además cubre el
    // caso de un `win` simulado en tests.
    sync();
  }

  function back() {
    if (depth > 0 && win.history) {
      win.history.back(); // el hashchange resultante hace sync()
    } else {
      navigate(parentOf(current || defaultPath));
    }
  }

  function start() {
    win.addEventListener("hashchange", sync);
    sync();
    return current;
  }

  return {
    navigate,
    back,
    start,
    sync,
    get current() {
      return current;
    },
  };
}
