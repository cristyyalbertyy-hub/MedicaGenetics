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
  collection,
  query,
  where,
  getDocs,
} from "https://esm.sh/firebase@12.15.0/firestore";

const config = window.STUDIO9_CONFIG || {};
const PACKAGE_ID = config.packageId || "genetics";
const STORE_URL =
  config.storeUrl || "https://medical-science-lilac.vercel.app/precos/";
const EMAIL_FOR_SIGN_IN_KEY = "studio9.emailForSignIn";

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
  await signInWithCustomToken(auth, token);
  params.delete("studio9_handoff");
  const rest = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${rest ? `?${rest}` : ""}`,
  );
}

async function fetchActiveEntitlement(db, userId) {
  const q = query(
    collection(db, "entitlements"),
    where("user_id", "==", userId),
    where("package_id", "==", PACKAGE_ID),
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;

  const data = snapshot.docs[0].data();
  const expiresAt = new Date(data.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return null;
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderGate(root, view) {
  root.hidden = false;
  root.replaceChildren();

  const card = document.createElement("div");
  card.className = "auth-card";

  if (view.type === "loading") {
    card.innerHTML = `<h1>Medical Genetics</h1><p class="auth-hint">A verificar acesso…</p>`;
    root.appendChild(card);
    return;
  }

  if (view.type === "unconfigured") {
    card.innerHTML =
      `<h1>Medical Genetics</h1>` +
      `<p class="form-error">Login temporariamente indisponível.</p>`;
    root.appendChild(card);
    return;
  }

  if (view.type === "sent") {
    card.innerHTML =
      `<h1>Medical Genetics</h1>` +
      `<p>Enviámos um link para <strong>${escapeHtml(view.email)}</strong>.</p>` +
      `<p class="auth-hint">Abra o email e clique no link para entrar.</p>` +
      `<button type="button" class="btn btn-secondary" data-action="back">Usar outro email</button>`;
    card.querySelector('[data-action="back"]')?.addEventListener("click", view.onBack);
    root.appendChild(card);
    return;
  }

  if (view.type === "no-access") {
    card.innerHTML =
      `<h1>Medical Genetics</h1>` +
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
    `<h1>Medical Genetics</h1>` +
    `<p class="auth-hint">Compre o módulo no site Medical Science e use o mesmo email para receber um link de acesso válido durante 1 ano.</p>` +
    `<form class="auth-form" id="auth-form">` +
    `<label><span>Email</span><input type="email" name="email" required placeholder="o email usado na compra" /></label>` +
    (view.error ? `<p class="form-error" role="alert">${escapeHtml(view.error)}</p>` : "") +
    `<button type="submit" class="btn btn-primary">${view.submitting ? "A enviar…" : "Enviar link de acesso"}</button>` +
    `</form>` +
    `<p class="demo-note">Recomendado: <a href="https://medical-science-lilac.vercel.app/conta/">Entrar pela conta Studio9</a> (1 magic link para todos os pacotes).</p>` +
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
  const db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);
  await trySessionHandoff(auth).catch(() => undefined);

  let loginState = { error: null, submitting: false, sent: false, email: "" };

  async function refreshEntitlementCheck() {
    renderGate(gateEl, { type: "loading" });
    const currentUser = auth.currentUser;
    if (!currentUser) {
      showLogin();
      return;
    }
    await grantAccessIfEntitled(currentUser);
  }

  async function grantAccessIfEntitled(user) {
    if (!user) return false;
    try {
      const entitlement = await fetchActiveEntitlement(db, user.uid);
      if (!entitlement) {
        renderGate(gateEl, {
          type: "no-access",
          email: user.email || "",
          onRefresh: () => void refreshEntitlementCheck(),
          onLogout: () => void signOut(auth).then(() => showLogin()),
        });
        return false;
      }
      gateEl.hidden = true;
      shellEl.hidden = false;
      addAccountBar(user.email || "");
      return true;
    } catch {
      renderGate(gateEl, {
        type: "no-access",
        email: user.email || "",
        onRefresh: () => void refreshEntitlementCheck(),
        onLogout: () => void signOut(auth).then(() => showLogin()),
      });
      return false;
    }
  }

  function addAccountBar(email) {
    const header = document.getElementById("app-header");
    if (!header || header.querySelector(".auth-account")) return;

    const wrap = document.createElement("div");
    wrap.className = "auth-account";
    wrap.innerHTML =
      `<span class="auth-account__email" title="${escapeHtml(email)}">${escapeHtml(email)}</span>` +
      `<button type="button" class="btn-ghost">Sair</button>`;
    wrap.querySelector("button")?.addEventListener("click", () => {
      void signOut(auth).then(() => window.location.reload());
    });

    const actions = document.createElement("div");
    actions.className = "app-header__actions";
    const progress = header.querySelector(".progress-link--header");
    if (progress) {
      actions.appendChild(wrap);
      actions.appendChild(progress);
      progress.remove();
      header.appendChild(actions);
    } else {
      header.appendChild(wrap);
    }
  }

  function showLogin() {
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

  async function checkSession() {
    await completeEmailLinkSignIn().catch(() => undefined);
    cleanEmailLinkFromUrl();
    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        if (user) {
          resolve(grantAccessIfEntitled(user));
          return;
        }
        showLogin();
        resolve(false);
      });
    });
  }

  onAuthStateChanged(auth, (user) => {
    if (user) void grantAccessIfEntitled(user);
  });

  return checkSession();
}
