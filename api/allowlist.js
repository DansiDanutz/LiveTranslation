import { OWNER_EMAIL, SUPABASE_URL, verifyUser } from "../lib/guard.js";
import { parseRequestBody } from "../lib/request.js";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serviceHeaders(prefer) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const parsed = parseRequestBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const { accessToken, action } = parsed.body;
  const user = await verifyUser(accessToken);
  if (!user) return res.status(401).json({ error: "Not authenticated." });
  if (String(user.email || "").toLowerCase() !== OWNER_EMAIL) {
    return res.status(403).json({ error: "Owner access required." });
  }
  if (!SERVICE_KEY) return res.status(503).json({ error: "Owner access is not configured." });

  let url;
  let options = { headers: serviceHeaders() };
  if (action === "list-allowlist") {
    url = `${SUPABASE_URL}/rest/v1/app_allowlist?select=email&order=created_at.desc`;
  } else if (action === "list-signins") {
    url = `${SUPABASE_URL}/rest/v1/app_signins?select=email,name,last_seen&order=last_seen.desc&limit=100`;
  } else {
    const email = String(parsed.body.email || "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return res.status(400).json({ error: "Invalid email." });
    if (action === "allow") {
      url = `${SUPABASE_URL}/rest/v1/app_allowlist`;
      options = {
        method: "POST",
        headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify({ email, added_by: OWNER_EMAIL }),
      };
    } else if (action === "remove") {
      url = `${SUPABASE_URL}/rest/v1/app_allowlist?email=eq.${encodeURIComponent(email)}`;
      options = { method: "DELETE", headers: serviceHeaders() };
    } else {
      return res.status(400).json({ error: "Unsupported owner action." });
    }
  }

  try {
    const upstream = await fetch(url, options);
    const payload = upstream.status === 204 ? null : await upstream.json().catch(() => null);
    if (!upstream.ok) return res.status(upstream.status).json({ error: "Owner data request failed." });
    return res.status(200).json(payload);
  } catch {
    return res.status(502).json({ error: "Owner data request failed." });
  }
}
