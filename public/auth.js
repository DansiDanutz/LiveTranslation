// auth.js
// Thin wrapper around Supabase Auth for Google sign-in. Loads the Supabase
// client from a CDN (ESM) and exposes a tiny API the app uses. If Supabase is
// not configured on the server, auth is bypassed (open/demo mode).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let supabase = null;
let authRequired = false;

export async function initAuth() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  authRequired = cfg.authRequired;
  if (authRequired) {
    supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
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
