// api/token.js — Vercel serverless function.
// Mints a short-lived OpenAI ephemeral client secret for a WebRTC translation
// session. The standard API key never leaves the server; the browser only ever
// receives a short-lived token scoped to one translation session.

import crypto from "node:crypto";
import { guardTranslation } from "../lib/guard.js";
import { outputLanguage, parseRequestBody } from "../lib/request.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-realtime-translate";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const parsed = parseRequestBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const body = parsed.body;
  const language = outputLanguage(body.language);
  if (!language) return res.status(400).json({ error: "Unsupported output language." });
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "Server is missing OPENAI_API_KEY." });
  }

  // Auth + email allowlist + per-user daily cap + global budget stop.
  const gate = await guardTranslation(body.accessToken);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  const user = gate.user;

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
