const fs = require("fs");
const path = require("path");

function env(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

const cfg = {
  firebaseApiKey: env("VITE_FIREBASE_API_KEY"),
  firebaseAuthDomain: env("VITE_FIREBASE_AUTH_DOMAIN"),
  firebaseProjectId: env("VITE_FIREBASE_PROJECT_ID"),
  firebaseAppId: env("VITE_FIREBASE_APP_ID"),
  packageId: env("VITE_PACKAGE_ID", "genetics"),
  appTitle: env("VITE_APP_TITLE", "Medical Genetics"),
  storeUrl: env("VITE_STORE_URL", "https://studio9medical.com/precos/"),
  accountUrl: env("VITE_ACCOUNT_URL", "https://studio9medical.com/conta/"),
  progressUrl: env(
    "VITE_PROGRESS_URL",
    `https://progress-azure-five.vercel.app/?package=${env("VITE_PACKAGE_ID", "genetics")}`,
  ),
};

const out = `window.STUDIO9_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
const target = path.join(__dirname, "..", "config.public.js");
fs.writeFileSync(target, out, "utf8");
console.log("Wrote", target);
