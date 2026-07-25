export function publicAssetUrl(path) {
  const file = path.replace(/^\/?public\//, "");
  const cfg = window.STUDIO9_CONFIG || {};
  if (cfg.mediaOrigin) {
    const origin = cfg.mediaOrigin.endsWith("/") ? cfg.mediaOrigin : `${cfg.mediaOrigin}/`;
    return `${origin}public/${file}`;
  }
  const base = (cfg.basePath || "/").replace(/\/?$/, "/");
  return `${base}public/${file}`;
}
