// auth.js
// Dependency-free Supabase Google sign-in using the implicit OAuth redirect
// flow. No external SDK / CDN is loaded at runtime — we just redirect to
// Supabase's authorize endpoint and read the returned session from the URL.
// This is far more robust than loading the JS SDK from a CDN.

let SUPABASE_URL = "";
let SUPABASE_ANON_KEY = "";
let authRequired = false;
const STORE_KEY = "lt-supabase-session";
let pendingError = null;

export async function initAuth() {
  let cfg;
  try {
    cfg = await fetch("/api/config").then((r) => r.json());
  } catch {
    cfg = { authRequired: false, model: "gpt-realtime-translate", keyConfigured: false };
  }
  authRequired = Boolean(cfg.authRequired);
  SUPABASE_URL = (cfg.supabaseUrl || "").replace(/\/$/, "");
  SUPABASE_ANON_KEY = cfg.supabaseAnonKey || "";

  if (authRequired) captureSessionFromUrl();
  return cfg;
}

// When returning from Google, Supabase appends the session to the URL hash
// (implicit flow): #access_token=...&refresh_token=...&expires_in=...
function captureSessionFromUrl() {
  const hash = window.location.hash || "";
  if (hash.includes("access_token=")) {
    const p = new URLSearchParams(hash.slice(1));
    const access_token = p.get("access_token");
    const refresh_token = p.get("refresh_token");
    const expires_in = parseInt(p.get("expires_in") || "3600", 10);
    if (access_token) {
      saveSession({ access_token, refresh_token, expires_at: Date.now() + expires_in * 1000 });
    }
    cleanUrl();
  } else if (hash.includes("error")) {
    const p = new URLSearchParams(hash.slice(1));
    pendingError = p.get("error_description") || p.get("error") || "Sign-in failed.";
    cleanUrl();
  }
}

function cleanUrl() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

function saveSession(s) {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}
function getSession() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  } catch {
    return null;
  }
}

export function isAuthRequired() {
  return authRequired;
}

export function consumeAuthError() {
  const e = pendingError;
  pendingError = null;
  return e;
}

export async function getUser() {
  if (!authRequired) return { id: "demo", email: "Guest", user_metadata: {} };
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      localStorage.removeItem(STORE_KEY);
      return null;
    }
    return await r.json();
  } catch {
    return null;
  }
}

export async function getAccessToken() {
  if (!authRequired) return "demo";
  let s = getSession();
  if (!s?.access_token) return null;
  // Refresh if close to expiry and we have a refresh token.
  if (s.refresh_token && s.expires_at && Date.now() > s.expires_at - 60000) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (r.ok) {
        const j = await r.json();
        s = {
          access_token: j.access_token,
          refresh_token: j.refresh_token || s.refresh_token,
          expires_at: Date.now() + (j.expires_in || 3600) * 1000,
        };
        saveSession(s);
      } else if (r.status === 400 || r.status === 401) {
        // Refresh token revoked/expired — the session is dead. Drop it so the
        // app shows the sign-in screen instead of failing every API call.
        localStorage.removeItem(STORE_KEY);
        return null;
      }
    } catch {
      /* keep existing token */
    }
  }
  return s.access_token;
}

export function signInWithGoogle() {
  if (!authRequired) return;
  const redirectTo = window.location.origin;
  window.location.href =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

export async function signOut() {
  if (!authRequired) return;
  const s = getSession();
  localStorage.removeItem(STORE_KEY);
  if (s?.access_token) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
      });
    } catch {
      /* ignore */
    }
  }
}

// Redirect flow needs no realtime listener — the session is captured on load.
export function onAuthChange() {}
