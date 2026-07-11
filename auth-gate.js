import { initializeApp } from "firebase/app";
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
} from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";

const config = window.STUDIO9_CONFIG || {};
const PACKAGE_ID = config.packageId || "genetics";
const STORE_URL =
  config.storeUrl || "https://studio9medical.com/precos/";
const ACCOUNT_URL =
  config.accountUrl || "https://studio9medical.com/conta/";
const EMAIL_FOR_SIGN_IN_KEY = "studio9.emailForSignIn";
const APP_TITLE = config.appTitle || "Medical Genetics";
const ENTITLEMENT_TIMEOUT_MS = 12_000;
const GATE_TIMEOUT_MS = 20_000;

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

/** Same entitlement lookup pattern as Medical Biology. */
async function fetchActiveEntitlement(db, userId) {
  const directSnap = await getDoc(
    doc(db, "entitlements", `${userId}_${PACKAGE_ID}`),
  );
  if (directSnap.exists()) {
    const active = parseActiveEntitlement(directSnap.data());
    if (active) return active;
  }

  const snapshot = await getDocs(
    query(
      collection(db, "entitlements"),
      where("user_id", "==", userId),
      where("package_id", "==", PACKAGE_ID),
    ),
  );
  if (snapshot.empty) return null;

  return parseActiveEntitlement(snapshot.docs[0].data());
}

/** @type {{ auth: import('firebase/auth').Auth, db: import('firebase/firestore').Firestore, user: import('firebase/auth').User, packageId: string } | null} */
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

  const params = new URLSearchParams(window.location.search);
  const handoffToken = params.get("studio9_handoff");
  const hasHandoff = Boolean(handoffToken);
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
      sessionStorage.removeItem("studio9_from_conta");
      sessionStorage.removeItem("studio9_open_package");
      void signOut(auth).then(() => {
        window.location.assign(ACCOUNT_URL);
      });
    });

    const actions = document.createElement("div");
    actions.className = "app-header__actions";
    actions.appendChild(wrap);
    header.appendChild(actions);
  }

  function revealApp(user, db) {
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

  if (hasHandoff) {
    try {
      await withTimeout(
        signInWithCustomToken(auth, handoffToken),
        15_000,
        "handoff",
      );
      params.delete("studio9_handoff");
      params.delete("studio9_open");
      const rest = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${rest ? `?${rest}` : ""}`,
      );

      const user = auth.currentUser;
      if (!user) {
        throw new Error("Sessão inválida após handoff.");
      }

      revealApp(user, getFirestore(app));
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível iniciar sessão.";
      renderGate(gateEl, {
        type: "handoff-error",
        message:
          message.includes("timeout") ||
          message.includes("custom-token") ||
          message.includes("expired")
            ? "A ligação expirou. Volte a abrir o Genetics pela Minha conta."
            : message,
      });
      return false;
    }
  }

  const db = getFirestore(app);

  async function bootstrap() {
    await withTimeout(
      setPersistence(auth, browserLocalPersistence),
      10_000,
      "persistence",
    ).catch(() => undefined);

    if (isSignInWithEmailLink(auth, window.location.href)) {
      let email = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
      if (!email) {
        email = window.prompt("Confirme o email usado para pedir o link de acesso");
      }
      if (email) {
        await signInWithEmailLink(auth, email, window.location.href);
        window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
        cleanEmailLinkFromUrl();
      }
    }
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

  async function grantAccessIfEntitled(user) {
    if (!user) return false;
    if (accessGranted) return true;
    renderGate(gateEl, { type: "loading" });

    try {
      const entitlement = await withTimeout(
        fetchActiveEntitlement(db, user.uid),
        ENTITLEMENT_TIMEOUT_MS,
        "entitlement",
      );
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
      revealApp(user, db);
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

  await bootstrap();

  const userAfterBootstrap = auth.currentUser;
  if (userAfterBootstrap) {
    return grantAccessIfEntitled(userAfterBootstrap);
  }

  return new Promise((resolve) => {
    let settled = false;

    const gateTimer = setTimeout(() => {
      if (settled || accessGranted) return;
      settled = true;
      unsubscribe();
      renderGate(gateEl, {
        type: "check-error",
        message:
          "A verificação demorou demasiado. Tente novamente ou abra pela Minha conta.",
        onRefresh: () => window.location.reload(),
      });
      resolve(false);
    }, GATE_TIMEOUT_MS);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (accessGranted || settled) return;

      if (user) {
        void grantAccessIfEntitled(user).then((ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(gateTimer);
          unsubscribe();
          resolve(ok);
        });
        return;
      }

      settled = true;
      clearTimeout(gateTimer);
      unsubscribe();
      showLogin();
      resolve(false);
    });
  });
}
