// api/summarize.js — Vercel serverless function.
// Summarizes a translation session transcript (mode: "session") or combines
// several session summaries into one overall summary (mode: "overall").
// Reuses the server-side OpenAI key via the Chat Completions API.

import { guardLight } from "../lib/guard.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "gpt-4o-mini";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Server is missing OPENAI_API_KEY." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const gate = await guardLight(body.accessToken);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const text = String(body.text || "").slice(0, 24000).trim();
  if (!text) return res.status(400).json({ error: "Nothing to summarize." });

  const mode = ["overall", "actions", "translate"].includes(body.mode) ? body.mode : "session";
  const language = (body.language || "").trim();

  const writeIn = language ? ` Write the output in ${language}.` : "";
  let system;
  if (mode === "translate") {
    system = `You are a professional translator. Translate the user's text into ${language || "Romanian"}. Preserve the meaning, tone, and paragraph breaks. Output ONLY the translation — no preamble, no notes.`;
  } else if (mode === "overall") {
    system = `You receive several short summaries, each from a separate live speech-translation session. Produce ONE concise overall summary that synthesizes the recurring themes, key points, and any decisions across all sessions.${writeIn} Format: a one-line 'TL;DR:' followed by 3-6 short bullet points starting with '- '. Be faithful; do not invent details.`;
  } else if (mode === "actions") {
    system = `Extract practical ACTION ITEMS and DECISIONS from this translation session transcript.${writeIn} Format exactly: a line 'Action items:' then '- ' bullets (each a clear task, include who/when if stated); then a line 'Decisions:' then '- ' bullets. If a section has none, write '- none'. Be faithful; do not invent.`;
  } else {
    system = `You summarize the transcript of a live speech-translation session.${writeIn} Format: a one-line 'TL;DR:' followed by 3-6 short bullet points starting with '- '. Capture the key content and intent. Be faithful; do not invent details.`;
  }

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
        // Full-transcript translations need room; summaries stay short.
        max_tokens: mode === "translate" ? 2500 : 450,
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
