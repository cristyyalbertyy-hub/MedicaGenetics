import { runAccessGate } from "./auth-gate.js";

const allowed = await runAccessGate();
if (allowed) {
  try {
    const { init } = await import("./app.js");
    init();
  } catch (error) {
    const gateEl = document.getElementById("auth-gate");
    const shellEl = document.getElementById("app-shell");
    if (gateEl && shellEl) {
      shellEl.hidden = true;
      gateEl.hidden = false;
      const message =
        error instanceof Error ? error.message : "Erro ao carregar a aplicação.";
      gateEl.innerHTML = `<div class="auth-card"><h1>Medical Genetics</h1><p class="form-error">${message}</p><p class="auth-hint">Tente recarregar a página (Ctrl+F5).</p></div>`;
    }
    console.error("Genetics init failed", error);
  }
}
