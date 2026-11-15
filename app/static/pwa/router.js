// Enrutado por hash: una pantalla por paso (ADR-0024/0025). Atrás del sistema navega por
// el history API; sin historial interno va a la pantalla padre.
// routes: {"/inicio": HTMLElement}; paramRoutes: ["/equipos/nuevo"] admite "/equipos/nuevo/<paso>".
// aliases: {"/activo": "/visita"} (rutas antiguas). guards: {"/ruta": (param) => "/otra" | null}.
// Copia idéntica en openfield-platform/app/static/pwa/router.js (ADR-0018).

export function matchRoute(hash, routes, paramRoutes = [], aliases = {}) {
  let p = (hash || "").replace(/^#/, "");
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/+$/, "") || "/";
  if (aliases[p]) p = aliases[p];
  if (routes[p]) return { path: p, base: p, param: null };
  const bases = [...paramRoutes].sort((a, b) => b.length - a.length);
  for (const base of bases) {
    if (routes[base] && p.startsWith(`${base}/`)) {
      const param = p.slice(base.length + 1);
      if (param && !param.includes("/")) return { path: p, base, param };
    }
  }
  return null;
}

export function normalizePath(hash, routes, fallback = "/inicio", paramRoutes = [], aliases = {}) {
  const m = matchRoute(hash, routes, paramRoutes, aliases);
  return m ? m.path : fallback;
}

export function parentOf(path, fallback = "/inicio") {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : fallback;
}

export function createRouter({
  routes,
  defaultPath = "/inicio",
  guards = {},
  paramRoutes = [],
  aliases = {},
  onShow = () => {},
  onLeave = () => {},
  win = window,
} = {}) {
  let current = null;
  let currentBase = null;
  let currentParam = null;
  let depth = 0; // entradas de historial creadas dentro de la app
  let expectPush = false;

  const match = (p) => matchRoute(p, routes, paramRoutes, aliases);

  function resolve(path) {
    let p = path;
    for (let i = 0; i < 5; i++) {
      const m = match(p);
      const g = m && guards[m.base];
      const redirect = g ? g(m.param) : null;
      if (!redirect || redirect === p) break;
      p = redirect;
    }
    return match(p) ? match(p).path : defaultPath;
  }

  function show(path) {
    const prev = current;
    if (prev === path) return;
    const m = match(path);
    if (prev) onLeave(prev, path);
    current = path;
    currentBase = m.base;
    currentParam = m.param;
    for (const [p, el] of Object.entries(routes)) el.hidden = p !== m.base;
    onShow(path, prev, m.param);
  }

  // Procesa el hash actual: resuelve guardas y muestra la pantalla.
  function sync() {
    const p = resolve(normalizePath(win.location.hash, routes, defaultPath, paramRoutes, aliases));
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
    get base() {
      return currentBase;
    },
    get param() {
      return currentParam;
    },
    get depth() {
      return depth;
    },
  };
}
