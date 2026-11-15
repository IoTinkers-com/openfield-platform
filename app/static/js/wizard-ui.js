// Render DOM de un wizard (ADR-0025). Copias idénticas: wearable app/, platform static/pwa/ y static/js/.
// renderStep(step, data, bodyEl, wiz) pinta los campos del paso y llama a wiz.set(...) al editar.
// onStepChange(stepId, "next"|"back") permite al llamador sincronizar el historial.
export function mountWizard(root, wiz, {
  title = "", renderStep, onFinish, onClose = () => {}, onStepChange = () => {}, finishLabel = "Crear",
} = {}) {
  root.innerHTML = `
    <div class="of-wizard">
      <div class="of-wizard-top">
        <button type="button" class="of-btn" data-w="close" aria-label="Cerrar">✕</button>
        <strong class="of-wizard-title"></strong>
        <span class="of-wizard-count"></span>
      </div>
      <progress class="of-progress" max="100" value="0"></progress>
      <div class="of-wizard-body">
        <h2 class="of-section-title" data-w="step-title"></h2>
        <div data-w="body"></div>
        <p class="of-status danger" data-w="error" role="alert"></p>
      </div>
      <div class="of-wizard-bar">
        <button type="button" class="of-btn" data-w="back">‹ Atrás</button>
        <button type="button" class="of-btn primary" data-w="next">Continuar</button>
      </div>
    </div>`;
  const q = (name) => root.querySelector(`[data-w="${name}"]`);
  root.querySelector(".of-wizard-title").textContent = title;

  function render() {
    if (!root.querySelector(".of-wizard")) return; // el wizard ya se cerró/destruyó
    const step = wiz.current();
    const { n, m } = wiz.progress();
    root.querySelector(".of-wizard-count").textContent = `Paso ${n} de ${m}`;
    root.querySelector("progress").value = Math.round((n / m) * 100);
    q("step-title").textContent = step.title;
    q("error").textContent = "";
    q("body").innerHTML = "";
    renderStep(step, wiz.data, q("body"), wiz, render);
    q("next").textContent = n === m ? (step.finishLabel || finishLabel) : "Continuar";
  }

  q("next").addEventListener("click", async () => {
    const res = wiz.next();
    if (!res.ok) { q("error").textContent = res.error; return; }
    if (res.done) {
      // onFinish puede cerrar y destruir el wizard: no tocar el DOM después sin comprobar.
      const btn = q("next");
      const label = btn ? btn.textContent : finishLabel;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="of-spin"></span> ${label}`;
      }
      try {
        await onFinish(wiz.data);
      } catch (e) {
        const err = q("error");
        if (err) err.textContent = e.message || String(e);
      } finally {
        const again = q("next");
        if (again) {
          again.disabled = false;
          again.textContent = label;
        }
      }
      return;
    }
    onStepChange(wiz.current().id, "next");
    render();
  });
  q("back").addEventListener("click", () => {
    if (wiz.back()) { onStepChange(wiz.current().id, "back"); render(); } else onClose();
  });
  q("close").addEventListener("click", () => onClose());
  return { render, destroy() { root.innerHTML = ""; } };
}
