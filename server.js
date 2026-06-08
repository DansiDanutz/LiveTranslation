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

// Documented model + endpoint for live speech-to-speech translation.
const MODEL = "gpt-realtime-translate";
const OPENAI_TRANSLATIONS_URL = `wss://api.openai.com/v1/realtime/translations?model=${MODEL}`;

if (!OPENAI_API_KEY) {
  console.warn(
    "[warn] OPENAI_API_KEY is not set. Copy .env.example to .env and add your key."
  );
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

// Lightweight health/info endpoint so the browser can show config + status.
app.get("/api/config", (_req, res) => {
  res.json({
    model: MODEL,
    keyConfigured: Boolean(OPENAI_API_KEY),
    pricePerMinuteUsd: 0.034, // documented: priced by audio duration
  });
});

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Browser <-> server WebSocket. The browser streams 24 kHz PCM16 audio here;
// we relay it to OpenAI and pipe translated audio + transcripts back.
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws/translate" });

wss.on("connection", (client) => {
  if (!OPENAI_API_KEY) {
    client.send(
      JSON.stringify({ type: "error", message: "Server missing OPENAI_API_KEY." })
    );
    client.close();
    return;
  }

  // Open the upstream translation session.
  const upstream = new WebSocket(OPENAI_TRANSLATIONS_URL, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  let targetLanguage = "es"; // default; overridden by the browser's "start" msg

  upstream.on("open", () => {
    client.send(JSON.stringify({ type: "status", state: "connected" }));
  });

  // Relay every upstream event to the browser untouched. The browser knows how
  // to react to session.output_audio.delta / *_transcript.delta / session.closed.
  upstream.on("message", (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });

  upstream.on("close", () => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "status", state: "closed" }));
      client.close();
    }
  });

  upstream.on("error", (err) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "error", message: String(err.message || err) }));
    }
  });

  // Messages from the browser.
  client.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "start") {
      targetLanguage = msg.language || targetLanguage;
      // Configure the translation session: output audio in the target language.
      sendUpstream(upstream, {
        type: "session.update",
        session: { audio: { output: { language: targetLanguage } } },
      });
      return;
    }

    if (msg.type === "audio") {
      // Forward a base64 PCM16 chunk as a documented append event.
      sendUpstream(upstream, {
        type: "session.input_audio_buffer.append",
        audio: msg.audio,
      });
      return;
    }

    if (msg.type === "stop") {
      sendUpstream(upstream, { type: "session.close" });
      return;
    }
  });

  client.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN) {
      sendUpstream(upstream, { type: "session.close" });
      upstream.close();
    }
  });
});

function sendUpstream(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

server.listen(PORT, () => {
  console.log(`LiveTranslation running on http://localhost:${PORT}`);
});
