// api/summarize.js — Vercel serverless function.
// Summarizes a translation session transcript (mode: "session") or combines
// several session summaries into one overall summary (mode: "overall").
// Reuses the server-side OpenAI key via the Chat Completions API.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "gpt-4o-mini";

const DEFAULT_SUPABASE_URL = "https://okgwzwdtuhhpoyxyprzg.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_K6-zQYAtqaJFQqdfK5U4RA_U6TnWTGZ";
const SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const AUTH_REQUIRED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Server is missing OPENAI_API_KEY." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const user = await verifySupabaseUser(body.accessToken);
  if (!user) return res.status(401).json({ error: "Not authenticated. Please sign in." });

  const text = String(body.text || "").slice(0, 24000).trim();
  if (!text) return res.status(400).json({ error: "Nothing to summarize." });

  const mode = body.mode === "overall" ? "overall" : "session";
  const language = (body.language || "").trim();

  const writeIn = language ? ` Write the summary in ${language}.` : "";
  const system =
    mode === "overall"
      ? `You receive several short summaries, each from a separate live speech-translation session. Produce ONE concise overall summary that synthesizes the recurring themes, key points, and any decisions across all sessions.${writeIn} Format: a one-line 'TL;DR:' followed by 3-6 short bullet points starting with '- '. Be faithful; do not invent details.`
      : `You summarize the transcript of a live speech-translation session.${writeIn} Format: a one-line 'TL;DR:' followed by 3-6 short bullet points starting with '- '. Capture the key content and intent. Be faithful; do not invent details.`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
        temperature: 0.3,
        max_tokens: 450,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || "Summary failed." });
    }
    const summary = data.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ summary });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
