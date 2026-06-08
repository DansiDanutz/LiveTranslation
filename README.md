# 🎙️ LiveTranslation

Real-time **speech-to-speech translation** in the browser. You speak, and it
streams translated **audio + live captions** back while you're still talking —
powered by OpenAI's [`gpt-realtime-translate`](https://developers.openai.com/api/docs/models/gpt-realtime-translate)
model.

- **70+ input languages → 13 output languages** (auto source detection)
- **Live dual captions** (your speech + the translation)
- **Auto-playing translated voice**, pace-matched and low latency
- **Google sign-in** via Supabase (free), with optional transcript history
- **Your API key never reaches the browser** — a Node WebSocket relay holds it

> Built strictly on the documented translation endpoint:
> `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`,
> 24 kHz PCM16 audio, and the documented `session.update` /
> `session.input_audio_buffer.append` → `session.output_audio.delta` /
> `session.*_transcript.delta` events.

---

## How it works

```
 Browser mic ─▶ capture-worklet (24 kHz PCM16) ─▶  Node relay  ─▶ OpenAI
                                                   (holds key)      gpt-realtime-translate
 Speakers ◀── playback-worklet ◀── translated audio + captions ◀──┘
```

1. The browser captures mic audio and downsamples it to **24 kHz PCM16** in an
   `AudioWorklet`.
2. Audio is streamed to the Node server over a WebSocket.
3. The server authenticates the user (Supabase access token), opens the OpenAI
   translation session, and relays the documented events both ways.
4. Translated audio chunks play instantly; source + target transcripts render
   as live captions.

---

## Quick start

### 1. Prerequisites
- Node.js 18+
- An OpenAI API key with access to `gpt-realtime-translate`
- (Optional but recommended) a free Supabase project for Google sign-in

### 2. Install
```bash
npm install
cp .env.example .env
# edit .env and add OPENAI_API_KEY (and Supabase values if using sign-in)
```

### 3. Run
```bash
npm start
# open http://localhost:3000
```

Without Supabase configured, the app runs in **open/demo mode** (no sign-in).
Add the Supabase values to require **Google sign-in**.

---

## Setting up Google sign-in (Supabase — free)

1. Create a free project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Google**: enable it and paste your Google
   OAuth **Client ID/Secret** (create them in the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials)).
   - Authorized redirect URI:
     `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
   - Also add your app origin (e.g. `http://localhost:3000`) under
     **Authentication → URL Configuration → Redirect URLs**.
3. **Settings → API**: copy the **Project URL**, **anon public** key, and
   **service_role** key into `.env`.
4. (Optional) For saved transcript history, run
   [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.

That's it — restart the server and the login screen will show
**Continue with Google**.

---

## Configuration reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | ✅ | Server-side key for the translation model |
| `PORT` | — | Server port (default `3000`) |
| `SUPABASE_URL` | for auth | Supabase project URL |
| `SUPABASE_ANON_KEY` | for auth | Public anon key (safe in browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | Enables saving transcripts (keep secret) |

---

## Features

- One-tap mic, **spacebar** to toggle listening
- Source + target **live captions** (large, readable, scrollable)
- **Language swap** + remembers your last-used languages
- **Mic level meter** and live **status** indicator
- **Captions-only mode** (mute translated audio) + volume control
- **Session timer** and **live cost estimate** ($0.034/min, per docs)
- **Copy** / **download (.txt)** the transcript
- Responsive, accessible (ARIA live regions, reduced-motion, high contrast)

---

## Pricing

`gpt-realtime-translate` is billed by **audio duration: $0.034 / minute**
(not tokens), per the OpenAI documentation. The in-app cost meter reflects this.

---

## Project structure

```
LiveTranslation/
├── server.js                  # Express + WS relay, Supabase auth, persistence
├── public/
│   ├── index.html             # App shell (auth + translation views)
│   ├── styles.css             # Design system (tokens + components)
│   ├── app.js                 # App logic: capture, stream, captions, controls
│   ├── auth.js                # Supabase Google sign-in
│   ├── languages.js           # Documented input/output languages
│   ├── capture-worklet.js     # Mic → 24 kHz PCM16
│   └── playback-worklet.js    # Translated PCM16 → speakers
├── supabase/schema.sql        # Sessions table + RLS policies
├── .env.example
└── package.json
```

---

## Notes & limitations

- The translation model is a dedicated **speech-in → speech-out** pipe, not a
  chat agent. There is no `response.create`; translation flows from the audio
  stream itself.
- Source-language captions require input transcription, which this app enables
  via the documented `gpt-realtime-whisper` transcription model.
- Use **HTTPS** in production so the browser grants microphone access and
  WebSocket upgrades to `wss`.
