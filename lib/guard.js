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

// The owner is ALWAYS allowed and is the only admin who can manage the list.
export const OWNER_EMAIL = (process.env.OWNER_EMAIL || "semebitcoin@gmail.com").toLowerCase();

// Extra static allowlist via env: unset => none, "*" => open to anyone signed
// in, otherwise a comma-separated list. (The owner-managed DB list is added on
// top of this — see emailAllowed.)
const RAW_ALLOWED = process.env.ALLOWED_EMAILS;
const ENV_ALLOWED =
  RAW_ALLOWED === undefined
    ? []
    : RAW_ALLOWED.trim() === "*"
      ? null
      : RAW_ALLOWED.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Owner-managed allowlist stored in the app_allowlist table (cached briefly).
let _allowCache = { at: 0, list: [] };
async function dbAllowlist() {
  // Reading approved email addresses with the public anon key would require a
  // public RLS policy. Keep the list private and skip DB-backed entries when a
  // server-only service key has not been configured.
  if (!SERVICE_KEY) return [];
  if (Date.now() - _allowCache.at < 30000) return _allowCache.list;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/app_allowlist?select=email`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (r.ok) {
      const rows = await r.json();
      _allowCache = { at: Date.now(), list: rows.map((x) => String(x.email).toLowerCase()) };
    }
  } catch {
    /* table may not exist yet — fall back to owner + env only */
  }
  return _allowCache.list;
}

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

async function emailAllowed(user) {
  const email = String(user?.email || "").toLowerCase();
  if (ENV_ALLOWED === null) return true; // "*" — open to any signed-in user
  if (email && email === OWNER_EMAIL) return true; // owner is always allowed
  if (ENV_ALLOWED.includes(email)) return true; // static env allowlist
  return (await dbAllowlist()).includes(email); // owner-managed allowlist
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
  if (!(await emailAllowed(user)))
    return { status: 403, error: "This account isn't approved yet. Ask the owner to allow your email." };
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
