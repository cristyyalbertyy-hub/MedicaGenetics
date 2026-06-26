import { runAccessGate } from "./auth-gate.js";

const allowed = await runAccessGate();
if (allowed) {
  const { init } = await import("./app.js");
  init();
}
