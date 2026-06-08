// api/config.js — Vercel serverless function.
// Public runtime config for the browser (no secrets beyond the Supabase anon
// key, which is safe to expose).

// Defaults to the "moltbot" Supabase project. The publishable (anon) key is
// safe to expose in the browser by design; env vars override these.
const DEFAULT_SUPABASE_URL = "https://okgwzwdtuhhpoyxyprzg.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_K6-zQYAtqaJFQqdfK5U4RA_U6TnWTGZ";

export default function handler(_req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  res.status(200).json({
    model: "gpt-realtime-translate",
    keyConfigured: Boolean(process.env.OPENAI_API_KEY),
    pricePerMinuteUsd: 0.034, // documented: priced by audio duration
    authRequired: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    ownerEmail: (process.env.OWNER_EMAIL || "semebitcoin@gmail.com").toLowerCase(),
  });
}
