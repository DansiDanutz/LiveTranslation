// api/token.js — Vercel serverless function.
// Mints a short-lived OpenAI ephemeral client secret for a WebRTC translation
// session. The standard API key never leaves the server; the browser only ever
// receives a short-lived token scoped to one translation session.

import crypto from "node:crypto";

// Defaults to the "moltbot" Supabase project (publishable key is browser-safe);
// env vars override these.
const DEFAULT_SUPABASE_URL = "https://okgwzwdtuhhpoyxyprzg.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_K6-zQYAtqaJFQqdfK5U4RA_U6TnWTGZ";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const AUTH_REQUIRED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const MODEL = "gpt-realtime-translate";

// Verify a Supabase access token by asking Supabase who it belongs to.
async function verifySupabaseUser(accessToken) {
  if (!AUTH_REQUIRED) return { id: "demo" };
  if (!accessToken || accessToken === "demo") return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "Server is missing OPENAI_API_KEY." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const language = body.language || "es";
  const user = await verifySupabaseUser(body.accessToken);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated. Please sign in." });
  }

  // Stable, non-reversible per-user identifier for OpenAI safety tooling.
  const safetyId = crypto.createHash("sha256").update(String(user.id)).digest("hex");

  try {
    // Documented endpoint + body for a WebRTC translation client secret.
    const r = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyId,
      },
      body: JSON.stringify({
        session: { model: MODEL, audio: { output: { language } } },
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res
        .status(r.status)
        .json({ error: data?.error?.message || "Failed to create translation session." });
    }

    // Ephemeral token is returned in `value` (allow for a nested shape too).
    const value = data.value || data.client_secret?.value || data.client_secret;
    return res.status(200).json({ value, expires_at: data.expires_at });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
