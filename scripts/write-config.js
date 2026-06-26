const fs = require("fs");
const path = require("path");

const cfg = {
  firebaseApiKey: process.env.VITE_FIREBASE_API_KEY || "",
  firebaseAuthDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  firebaseProjectId: process.env.VITE_FIREBASE_PROJECT_ID || "",
  firebaseAppId: process.env.VITE_FIREBASE_APP_ID || "",
  packageId: process.env.VITE_PACKAGE_ID || "genetics",
  storeUrl:
    process.env.VITE_STORE_URL ||
    "https://medical-science-lilac.vercel.app/precos/",
};

const out = `window.STUDIO9_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
const target = path.join(__dirname, "..", "config.public.js");
fs.writeFileSync(target, out, "utf8");
console.log("Wrote", target);
