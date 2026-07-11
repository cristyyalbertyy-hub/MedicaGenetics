import { initializeApp } from "https://esm.sh/firebase@12.15.0/app";
import {
  getAuth,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  signInWithCustomToken,
  setPersistence,
  browserLocalPersistence,
} from "https://esm.sh/firebase@12.15.0/auth";
import {
  getFirestore,
  doc,
  getDoc,
} from "https://esm.sh/firebase@12.15.0/firestore";

const config = window.STUDIO9_CONFIG || {};
const PACKAGE_ID = config.packageId || "genetics";
const STORE_URL =
  config.storeUrl || "https://studio9medical.com/precos/";
const ACCOUNT_URL =
  config.accountUrl || "https://studio9medical.com/conta/";
const SITE_ORIGIN = new URL(ACCOUNT_URL).origin;
const EMAIL_FOR_SIGN_IN_KEY = "studio9.emailForSignIn";
const APP_TITLE = config.appTitle || "Medical Genetics";
const ENTITLEMENT_TIMEOUT_MS = 12_000;
const AUTH_WAIT_TIMEOUT_MS = 12_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label}-timeout`)), ms);
    }),
  ]);
}

function parseActiveEntitlement(data) {
  const expiresAt = new Date(data.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return null;
  }
  return data;
}

function isConfigured() {
  return Boolean(
    config.firebaseApiKey &&
      config.firebaseAuthDomain &&
      config.firebaseProjectId &&
      config.firebaseAppId,
  );
}

function authContinueUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function cleanEmailLinkFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("apiKey") && !url.searchParams.has("oobCode")) return;
  url.searchParams.delete("apiKey");
  url.searchParams.delete("oobCode");
  url.searchParams.delete("mode");
  url.searchParams.delete("lang");
  window.history.replaceState(null, "", url.pathname + url.search);
}

async function trySessionHandoff(auth) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("studio9_handoff");
  if (!token) return;
  await signOut(auth).catch(() => undefined);
  await signInWithCustomToken(auth, token);
  params.delete("studio9_handoff");
  const rest = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${rest ? `?${rest}` : ""}`,
  );
}

async function fetchActiveEntitlementViaApi(user) {
  const idToken = await withTimeout(user.getIdToken(), 8_000, "getIdToken");
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), ENTITLEMENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${SITE_ORIGIN}/api/my-entitlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : "Erro ao verificar acesso.",
      );
    }
    if ((data.package_ids ?? []).includes(PACKAGE_ID)) {
      return { package_id: PACKAGE_ID, user_id: user.uid };
    }
    return null;
  } finally {
    clearTimeout(abortTimer);
  }
}

async function fetchActiveEntitlementFromFirestore(db, userId) {
  const directRef = doc(db, "entitlements", `${userId}_${PACKAGE_ID}`);
  const directSnap = await getDoc(directRef);
  if (!directSnap.exists()) return null;
  return parseActiveEntitlement(directSnap.data());
}

async function resolveEntitlementFromHandoffClaims(user) {
  await withTimeout(user.getIdToken(true), 8_000, "getIdToken");
  const tokenResult = await withTimeout(user.getIdTokenResult(), 4_000, "getIdTokenResult");
  const packages = tokenResult.claims?.studio9_packages;
  if (Array.isArray(packages) && packages.includes(PACKAGE_ID)) {
    return { package_id: PACKAGE_ID, user_id: user.uid };
  }
  return null;
}

async function resolveEntitlement(user, db, preferHandoffClaims = false) {
  if (preferHandoffClaims) {
    try {
      const fromClaims = await withTimeout(
        resolveEntitlementFromHandoffClaims(user),
        10_000,
        "handoff-claims",
      );
      if (fromClaims) return fromClaims;
    } catch {
      /* fall through to shared checks */
    }
  }

  const results = await Promise.allSettled([
    withTimeout(
      fetchActiveEntitlementFromFirestore(db, user.uid),
      ENTITLEMENT_TIMEOUT_MS,
      "firestore",
    ),
    withTimeout(
      fetchActiveEntitlementViaApi(user),
      ENTITLEMENT_TIMEOUT_MS,
      "api",
    ),
  ]);

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      return result.value;
    }
  }
  return null;
}

/** @type {{ auth: import('firebase/auth').Auth, db: import('firebase/firestore').Firestore, user: import('firebase/auth').User, packageId: string, progressUrl: string } | null} */
let studio9Session = null;
/** @type {boolean} */
let accessGranted = false;

export function getStudio9Session() {
  return studio9Session;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderGate(root, view) {
  if (accessGranted) return;
  root.hidden = false;
  root.replaceChildren();

  const card = document.createElement("div");
  card.className = "auth-card";

  if (view.type === "loading") {
    card.innerHTML = `<h1>${escapeHtml(APP_TITLE)}</h1><p class="auth-hint">A verificar acesso…</p>`;
    root.appendChild(card);
    return;
  }

  if (view.type === "unconfigured") {
    card.innerHTML =
      `<h1>${escapeHtml(APP_TITLE)}</h1>` +
      `<p class="form-error">Login temporariamente indisponível.</p>`;
    root.appendChild(card);
    return;
  }

  if (view.type === "sent") {
    card.innerHTML =
      `<h1>${escapeHtml(APP_TITLE)}</h1>` +
      `<p>Enviámos um link para <strong>${escapeHtml(view.email)}</strong>.</p>` +
      `<p class="auth-hint">Abra o email e clique no link para entrar.</p>` +
      `<button type="button" class="btn btn-secondary" data-action="back">Usar outro email</button>`;
    card.querySelector('[data-action="back"]')?.addEventListener("click", view.onBack);
    root.appendChild(card);
    return;
  }

  if (view.type === "handoff-error") {
    card.innerHTML =
      `<h1>${escapeHtml(APP_TITLE)}</h1>` +
      `<p class="form-error">${escapeHtml(view.message)}</p>` +
      `<div class="auth-actions">` +
      `<a class="btn btn-primary" href="${escapeHtml(ACCOUNT_URL)}">Abrir pela Minha conta</a>` +
      `</div>`;
    root.appendChild(card);
    return;
  }

  if (view.type === "check-error") {
    card.innerHTML =
      `<h1>${escapeHtml(APP_TITLE)}</h1>` +
      `<p class="form-error">${escapeHtml(view.message)}</p>` +
      `<div class="auth-actions">` +
      `<button type="button" class="btn btn-secondary" data-action="refresh">Tentar novamente</button>` +
      `<a class="btn btn-primary" href="${escapeHtml(ACCOUNT_URL)}">Abrir pela Minha conta</a>` +
      `</div>`;
    card.querySelector('[data-action="refresh"]')?.addEventListener("click", view.onRefresh);
    root.appendChild(card);
    return;
  }

  if (view.type === "no-access") {
    card.innerHTML =
      `<h1>${escapeHtml(APP_TITLE)}</h1>` +
      `<p class="auth-hint">Sessão iniciada como <strong>${escapeHtml(view.email)}</strong>, mas ainda não há acesso activo a este módulo.</p>` +
      `<p class="auth-hint">Após a compra, o acesso online fica disponível durante 1 ano.</p>` +
      `<div class="auth-actions">` +
      `<a class="btn btn-primary" href="${escapeHtml(STORE_URL)}">Comprar acesso</a>` +
      `<button type="button" class="btn btn-secondary" data-action="refresh">Verificar acesso</button>` +
      `<button type="button" class="btn btn-ghost" data-action="logout">Terminar sessão</button>` +
      `</div>`;
    card.querySelector('[data-action="refresh"]')?.addEventListener("click", view.onRefresh);
    card.querySelector('[data-action="logout"]')?.addEventListener("click", view.onLogout);
    root.appendChild(card);
    return;
  }

  card.innerHTML =
    `<h1>${escapeHtml(APP_TITLE)}</h1>` +
    `<p class="auth-hint">Compre o módulo no site Medical Science e use o mesmo email para receber um link de acesso válido durante 1 ano.</p>` +
    `<form class="auth-form" id="auth-form">` +
    `<label><span>Email</span><input type="email" name="email" required placeholder="o email usado na compra" /></label>` +
    (view.error ? `<p class="form-error" role="alert">${escapeHtml(view.error)}</p>` : "") +
    `<button type="submit" class="btn btn-primary">${view.submitting ? "A enviar…" : "Enviar link de acesso"}</button>` +
    `</form>` +
    `<p class="demo-note">Recomendado: <a href="${escapeHtml(ACCOUNT_URL)}">Entrar pela conta Studio9</a> (Google ou link por email).</p>` +
    `<p class="demo-note">Ainda não comprou? <a href="${escapeHtml(STORE_URL)}" target="_blank" rel="noopener noreferrer">Ver preços e planos</a></p>`;

  const form = card.querySelector("#auth-form");
  form?.addEventListener("submit", view.onSubmit);
  root.appendChild(card);
}

export async function runAccessGate() {
  const gateEl = document.getElementById("auth-gate");
  const shellEl = document.getElementById("app-shell");
  if (!gateEl || !shellEl) return false;

  shellEl.hidden = true;
  gateEl.hidden = true;

  const hasHandoff = new URLSearchParams(window.location.search).has("studio9_handoff");
  renderGate(gateEl, { type: "loading" });

  if (!isConfigured()) {
    renderGate(gateEl, { type: "unconfigured" });
    return false;
  }

  const app = initializeApp({
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    projectId: config.firebaseProjectId,
    appId: config.firebaseAppId,
  });
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  const db = getFirestore(app);

  if (hasHandoff) {
    try {
      await trySessionHandoff(auth);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível iniciar sessão.";
      renderGate(gateEl, {
        type: "handoff-error",
        message:
          message.includes("custom-token") || message.includes("expired")
            ? "A ligação expirou. Volte a abrir o Genetics pela Minha conta."
            : message,
      });
      return false;
    }
  }

  let loginState = { error: null, submitting: false, sent: false, email: "" };

  function addAccountBar(email) {
    const header = document.getElementById("app-header");
    if (!header || header.querySelector(".auth-account")) return;

    const wrap = document.createElement("div");
    wrap.className = "auth-account";
    wrap.innerHTML =
      `<span class="auth-account__email" title="${escapeHtml(email)}">${escapeHtml(email)}</span>` +
      `<button type="button" class="btn-ghost">Sair</button>`;
    wrap.querySelector("button")?.addEventListener("click", () => {
      studio9Session = null;
      accessGranted = false;
      void signOut(auth).then(() => {
        window.location.assign(ACCOUNT_URL);
      });
    });

    const actions = document.createElement("div");
    actions.className = "app-header__actions";
    actions.appendChild(wrap);
    header.appendChild(actions);
  }

  function revealApp(user) {
    accessGranted = true;
    gateEl.hidden = true;
    gateEl.replaceChildren();
    shellEl.hidden = false;
    studio9Session = {
      auth,
      db,
      user,
      packageId: PACKAGE_ID,
    };
    addAccountBar(user.email || "");
  }

  async function refreshEntitlementCheck() {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      accessGranted = false;
      showLogin();
      return;
    }
    if (!accessGranted) {
      renderGate(gateEl, { type: "loading" });
    }
    await grantAccessIfEntitled(currentUser);
  }

  async function grantAccessIfEntitled(user, preferHandoffClaims = false) {
    if (!user) return false;
    if (accessGranted) return true;
    renderGate(gateEl, { type: "loading" });
    try {
      const entitlement = await resolveEntitlement(user, db, preferHandoffClaims);
      if (!entitlement) {
        accessGranted = false;
        shellEl.hidden = true;
        renderGate(gateEl, {
          type: "no-access",
          email: user.email || "",
          onRefresh: () => void refreshEntitlementCheck(),
          onLogout: () =>
            void signOut(auth).then(() => {
              window.location.assign(ACCOUNT_URL);
            }),
        });
        return false;
      }
      revealApp(user);
      return true;
    } catch (error) {
      accessGranted = false;
      shellEl.hidden = true;
      const timedOut =
        error instanceof Error && error.message.includes("timeout");
      renderGate(gateEl, {
        type: "check-error",
        message: timedOut
          ? "A verificação demorou demasiado. Tente novamente ou abra pela Minha conta."
          : "Não foi possível confirmar o acesso. Tente novamente.",
        onRefresh: () => void refreshEntitlementCheck(),
      });
      return false;
    }
  }

  function showLogin() {
    accessGranted = false;
    shellEl.hidden = true;
    if (loginState.sent) {
      renderGate(gateEl, {
        type: "sent",
        email: loginState.email,
        onBack: () => {
          loginState.sent = false;
          showLogin();
        },
      });
      return;
    }

    renderGate(gateEl, {
      type: "login",
      error: loginState.error,
      submitting: loginState.submitting,
      onSubmit: async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const email = form.email.value.trim();
        loginState = { ...loginState, submitting: true, error: null };
        showLogin();
        try {
          await sendSignInLinkToEmail(auth, email, {
            url: authContinueUrl(),
            handleCodeInApp: true,
          });
          window.localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email);
          loginState.submitting = false;
          loginState.sent = true;
          loginState.email = email;
          showLogin();
        } catch (error) {
          loginState.submitting = false;
          const message =
            error instanceof Error ? error.message : "Erro ao enviar link.";
          if (message.includes("auth/quota-exceeded")) {
            loginState.error =
              "Limite diário de emails atingido. Tente amanhã ou use a sessão já iniciada noutro separador.";
          } else {
            loginState.error = message;
          }
          showLogin();
        }
      },
    });
  }

  async function completeEmailLinkSignIn() {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    let email = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
    if (!email) {
      email = window.prompt("Confirme o email usado para pedir o link de acesso");
    }
    if (!email) return;
    await signInWithEmailLink(auth, email, window.location.href);
    window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
    cleanEmailLinkFromUrl();
  }

  async function waitForSignedInUser() {
    if (auth.currentUser) return auth.currentUser;
    return withTimeout(
      new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
          unsubscribe();
          resolve(nextUser);
        });
      }),
      AUTH_WAIT_TIMEOUT_MS,
      "auth-wait",
    ).catch(() => auth.currentUser);
  }

  async function checkSession() {
    await completeEmailLinkSignIn().catch(() => undefined);
    cleanEmailLinkFromUrl();

    if (hasHandoff) {
      const handoffUser = auth.currentUser;
      if (handoffUser) return grantAccessIfEntitled(handoffUser, true);
      showLogin();
      return false;
    }

    const user = await waitForSignedInUser();
    if (user) {
      return grantAccessIfEntitled(user);
    }
    showLogin();
    return false;
  }

  return checkSession();
}
