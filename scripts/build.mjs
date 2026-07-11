import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["main.js"],
  bundle: true,
  outfile: "bundle.js",
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  logLevel: "info",
});

console.log("Built bundle.js");
