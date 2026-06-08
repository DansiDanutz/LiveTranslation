// lib/guard.js — shared server-side access & spend controls for the API.
//
// Enforced before any OpenAI call so a public, key-backed app can't be abused:
//   - auth        : valid Supabase user required
//   - allowlist   : only approved emails may spend (defaults to the owner)
//   - per-user cap : max translation minutes per user per day (soft cap)
//   - budget stop : global daily USD budget (needs a service-role key to measure)
//
// All limits are env-configurable so you stay in control.

const DEFAULT_SUPABASE_URL = "https://okgwzwdtuhhpoyxyprzg.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_K6-zQYAtqaJFQqdfK5U4RA_U6TnWTGZ";

export const SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const PRICE_PER_MIN = 0.034;

// Allowlist: unset => owner only. "*" or empty => open to any signed-in user.
const RAW_ALLOWED = process.env.ALLOWED_EMAILS;
const ALLOWED =
  RAW_ALLOWED === undefined
    ? ["semebitcoin@gmail.com"]
    : RAW_ALLOWED.trim() === "*"
      ? null
      : RAW_ALLOWED.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const MAX_MIN_PER_USER = parseFloat(process.env.MAX_MINUTES_PER_USER_PER_DAY || "0"); // 0 = off
const DAILY_BUDGET_USD = parseFloat(process.env.DAILY_BUDGET_USD || "0"); // 0 = off

export async function verifyUser(accessToken) {
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

function emailAllowed(user) {
  if (ALLOWED === null || ALLOWED.length === 0) return true;
  return ALLOWED.includes(String(user?.email || "").toLowerCase());
}

function todayStartISO() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Minutes this user has used today (counts completed sessions; uses the user's
// own JWT so RLS applies). Best-effort soft cap.
async function userMinutesToday(user, accessToken) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/sessions?select=duration_seconds&user_id=eq.${user.id}&created_at=gte.${todayStartISO()}`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return 0;
    const rows = await r.json();
    return rows.reduce((s, x) => s + (x.duration_seconds || 0), 0) / 60;
  } catch {
    return 0;
  }
}

// Global estimated spend today (needs a service-role key to read all rows).
async function globalSpendToday() {
  if (!SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/sessions?select=duration_seconds&created_at=gte.${todayStartISO()}`;
    const r = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return (rows.reduce((s, x) => s + (x.duration_seconds || 0), 0) / 60) * PRICE_PER_MIN;
  } catch {
    return null;
  }
}

// Auth + allowlist only (for the cheap summarize/ask endpoints).
export async function guardLight(accessToken) {
  const user = await verifyUser(accessToken);
  if (!user) return { status: 401, error: "Not authenticated. Please sign in." };
  if (!emailAllowed(user)) return { status: 403, error: "This account isn't approved to use this app." };
  return { user };
}

// Full guard for the expensive translation token endpoint.
export async function guardTranslation(accessToken) {
  const base = await guardLight(accessToken);
  if (base.error) return base;
  const { user } = base;

  if (MAX_MIN_PER_USER > 0) {
    const used = await userMinutesToday(user, accessToken);
    if (used >= MAX_MIN_PER_USER) {
      return { status: 429, error: `Daily limit reached (${MAX_MIN_PER_USER} min/day). Try again tomorrow.` };
    }
  }
  if (DAILY_BUDGET_USD > 0) {
    const spend = await globalSpendToday();
    if (spend !== null && spend >= DAILY_BUDGET_USD) {
      return { status: 429, error: "The app's daily budget has been reached. Please try again later." };
    }
  }
  return { user };
}
