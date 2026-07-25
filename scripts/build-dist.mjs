import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distDir = path.join(root, "dist");
const base = (process.env.STUDIO9_SITE_BASE || "/").replace(/\/?$/, "/");
const mediaOrigin = (process.env.VITE_MEDIA_ORIGIN || "").trim();

const loadFallbackScript = `(function(){window.setTimeout(function(){var shell=document.getElementById('app-shell');var gate=document.getElementById('auth-gate');var loaded=(shell&&!shell.hidden)||(gate&&!gate.hidden&&gate.childElementCount);if(!loaded){document.body.innerHTML='<div style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1.25rem;color:#14213d;line-height:1.5"><h1 style="font-size:1.25rem;margin:0 0 0.75rem">Medical Genetics</h1><p style="margin:0 0 0.75rem">The app did not load — usually an outdated cached file in your browser.</p><p style="margin:0"><strong>Try:</strong> hard refresh (Ctrl+Shift+R) or open in a private window.</p></div>';}},4500);})();`;

function assetUrl(relativePath) {
  const clean = relativePath.replace(/^\//, "");
  return base === "/" ? `/${clean}` : `${base}${clean}`;
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

execSync("node scripts/write-config.cjs", { cwd: root, stdio: "inherit" });

await esbuild.build({
  entryPoints: [path.join(root, "main.js")],
  bundle: true,
  outfile: path.join(root, "bundle.js"),
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  logLevel: "info",
});

rmDir(distDir);
fs.mkdirSync(distDir, { recursive: true });

for (const file of ["styles.css", "favicon.svg", "config.public.js", "bundle.js"]) {
  fs.copyFileSync(path.join(root, file), path.join(distDir, file));
}

if (!mediaOrigin) {
  fs.cpSync(path.join(root, "public"), path.join(distDir, "public"), { recursive: true });
}

const indexTemplate = fs.readFileSync(path.join(root, "index.html"), "utf8");
const builtIndex = indexTemplate
  .replace('href="/favicon.svg"', `href="${assetUrl("favicon.svg")}"`)
  .replace('href="styles.css"', `href="${assetUrl("styles.css")}"`)
  .replace('src="public/GeneticsA.png"', 'src=""')
  .replace('src="config.public.js"', `src="${assetUrl("config.public.js")}"`)
  .replace('src="bundle.js"', `src="${assetUrl("bundle.js")}"`)
  .replace("</body>", `<script>${loadFallbackScript}</script></body>`);

fs.writeFileSync(path.join(distDir, "index.html"), builtIndex, "utf8");
console.log("Wrote", distDir, `(base=${base}${mediaOrigin ? `, media=${mediaOrigin}` : ""})`);
