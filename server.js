import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration — values come straight from the gpt-realtime-translate docs.
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Supabase (Google auth + optional transcript storage). The anon key is safe
// to expose to the browser; the service-role key (if set) stays server-side.
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AUTH_REQUIRED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Documented model + endpoint for live speech-to-speech translation.
const MODEL = "gpt-realtime-translate";
const OPENAI_TRANSLATIONS_URL = `wss://api.openai.com/v1/realtime/translations?model=${MODEL}`;

if (!OPENAI_API_KEY) {
  console.warn(
    "[warn] OPENAI_API_KEY is not set. Copy .env.example to .env and add your key."
  );
}
if (!AUTH_REQUIRED) {
  console.warn(
    "[warn] Supabase not configured — running in open/demo mode (no Google sign-in)."
  );
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Public runtime config for the browser (no secrets beyond the anon key).
app.get("/api/config", (_req, res) => {
  res.json({
    model: MODEL,
    keyConfigured: Boolean(OPENAI_API_KEY),
    pricePerMinuteUsd: 0.034, // documented: priced by audio duration
    authRequired: AUTH_REQUIRED,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
});

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Auth — verify a Supabase access token by asking Supabase who it belongs to.
// Returns the user object on success, or null.
// ---------------------------------------------------------------------------
async function verifySupabaseUser(accessToken) {
  if (!AUTH_REQUIRED) return { id: "demo", email: "demo@local" };
  if (!accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Best-effort transcript persistence (only if a service-role key is present).
async function saveSession({ userId, sourceText, targetText, language, seconds }) {
  if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL || userId === "demo") return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/sessions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        source_text: sourceText,
        target_text: targetText,
        target_language: language,
        duration_seconds: Math.round(seconds),
      }),
    });
  } catch (err) {
    console.warn("[warn] could not persist session:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Browser <-> server WebSocket. The browser streams 24 kHz PCM16 audio here;
// we relay it to OpenAI and pipe translated audio + transcripts back.
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws/translate" });

wss.on("connection", (client) => {
  if (!OPENAI_API_KEY) {
    client.send(JSON.stringify({ type: "error", message: "Server missing OPENAI_API_KEY." }));
    client.close();
    return;
  }

  let upstream = null;
  let user = null;
  let targetLanguage = "es";
  let startedAt = 0;
  const sourceParts = [];
  const targetParts = [];

  client.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ---- Authenticate before doing anything else --------------------------
    if (msg.type === "start") {
      user = await verifySupabaseUser(msg.accessToken);
      if (!user) {
        client.send(JSON.stringify({ type: "error", message: "Not authenticated. Please sign in." }));
        client.close();
        return;
      }
      targetLanguage = msg.language || targetLanguage;
      startedAt = Date.now();
      openUpstream(msg.transcribeSource !== false);
      return;
    }

    if (!upstream || upstream.readyState !== WebSocket.OPEN) return;

    if (msg.type === "audio") {
      sendUpstream(upstream, {
        type: "session.input_audio_buffer.append",
        audio: msg.audio, // base64 24 kHz PCM16
      });
      return;
    }

    if (msg.type === "set_language") {
      targetLanguage = msg.language || targetLanguage;
      sendUpstream(upstream, {
        type: "session.update",
        session: { audio: { output: { language: targetLanguage } } },
      });
      return;
    }

    if (msg.type === "stop") {
      sendUpstream(upstream, { type: "session.close" });
    }
  });

  function openUpstream(transcribeSource) {
    upstream = new WebSocket(OPENAI_TRANSLATIONS_URL, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    upstream.on("open", () => {
      // Documented session configuration for live translation.
      const session = {
        audio: {
          input: { noise_reduction: { type: "near_field" } },
          output: { language: targetLanguage },
        },
      };
      // Optional source-language transcript via the streaming whisper model.
      if (transcribeSource) {
        session.audio.input.transcription = { model: "gpt-realtime-whisper" };
      }
      sendUpstream(upstream, { type: "session.update", session });
      client.send(JSON.stringify({ type: "status", state: "connected" }));
    });

    upstream.on("message", (data) => {
      const text = data.toString();
      // Tap transcript deltas so we can persist the session at the end.
      try {
        const evt = JSON.parse(text);
        if (evt.type === "session.input_transcript.delta" && evt.delta)
          sourceParts.push(evt.delta);
        if (evt.type === "session.output_transcript.delta" && evt.delta)
          targetParts.push(evt.delta);
      } catch {
        /* pass through regardless */
      }
      if (client.readyState === WebSocket.OPEN) client.send(text);
    });

    upstream.on("close", () => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "status", state: "closed" }));
      }
      persist();
    });

    upstream.on("error", (err) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "error", message: String(err.message || err) }));
      }
    });
  }

  function persist() {
    if (!user || !startedAt) return;
    saveSession({
      userId: user.id,
      sourceText: sourceParts.join(""),
      targetText: targetParts.join(""),
      language: targetLanguage,
      seconds: (Date.now() - startedAt) / 1000,
    });
    startedAt = 0;
  }

  client.on("close", () => {
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      sendUpstream(upstream, { type: "session.close" });
      upstream.close();
    }
    persist();
  });
});

function sendUpstream(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

server.listen(PORT, () => {
  console.log(`LiveTranslation running on http://localhost:${PORT}`);
});
