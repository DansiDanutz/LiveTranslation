// auth.js
// Thin wrapper around Supabase Auth for Google sign-in. The Supabase SDK is
// loaded *lazily* (dynamic import) only when sign-in is actually configured, so
// a CDN hiccup can never blank out the app — and demo mode needs no network SDK.

let supabase = null;
let authRequired = false;

export async function initAuth() {
  let cfg;
  try {
    cfg = await fetch("/api/config").then((r) => r.json());
  } catch {
    cfg = { authRequired: false, model: "gpt-realtime-translate", keyConfigured: false };
  }
  authRequired = Boolean(cfg.authRequired);

  if (authRequired) {
    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (err) {
      // If the SDK can't load, fall back to demo mode rather than breaking the app.
      console.error("Supabase SDK failed to load; falling back to demo mode.", err);
      authRequired = false;
    }
  }
  return cfg;
}

export function isAuthRequired() {
  return authRequired;
}

export async function getUser() {
  if (!authRequired) return { id: "demo", email: "Guest", user_metadata: {} };
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

export async function getAccessToken() {
  if (!authRequired) return "demo";
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

export async function signInWithGoogle() {
  if (!authRequired) return;
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut() {
  if (!authRequired) return;
  await supabase.auth.signOut();
}

export function onAuthChange(callback) {
  if (!authRequired) return;
  supabase.auth.onAuthStateChange((_event, session) => callback(session?.user || null));
}
