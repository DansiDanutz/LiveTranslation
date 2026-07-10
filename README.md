# 🎙️ LiveTranslation

Real-time **speech-to-speech translation** in the browser. You speak, and it
streams translated **audio + live captions** back while you're still talking —
powered by OpenAI's [`gpt-realtime-translate`](https://developers.openai.com/api/docs/models/gpt-realtime-translate)
model, connected over **WebRTC**.

- **70+ input languages → 13 output languages** (auto source detection)
- **Live dual captions** (your speech + the translation)
- **Auto-playing translated voice**, pace-matched and low latency
- **Google sign-in** via Supabase (free)
- **Deploys to Vercel** — your API key never reaches the browser

> Built on the documented WebRTC translation flow:
> ephemeral token from `POST /v1/realtime/translations/client_secrets`, then a
> browser WebRTC call to `POST /v1/realtime/translations/calls` with an
> `oai-events` data channel for transcripts.

---

## How it works

```
 Browser                              Your serverless /api/token        OpenAI
 ───────                              ─────────────────────────        ──────
 1. POST /api/token  ───────────────▶ verify Supabase user
                                      mint ephemeral token  ──────────▶ /translations/client_secrets
 2. WebRTC offer (mic) ───────────────────────────────────────────────▶ /translations/calls
 3. ◀── translated audio (media track) + transcripts (data channel) ───
```

1. The browser asks our serverless `/api/token` function for a **short-lived
   token**. The function verifies the signed-in user (Supabase) and mints the
   token using the secret OpenAI key — which never leaves the server.
2. The browser opens a **WebRTC** peer connection, sends its mic audio, and
   completes the SDP handshake directly with OpenAI.
3. Translated **audio** comes back as a media track (plays instantly);
   **source + target transcripts** arrive over the `oai-events` data channel and
   render as live captions.

Because there's no long-lived server socket, this runs perfectly on Vercel's
serverless platform.

---

## Quick start (local)

```bash
npm install
cp .env.example .env          # add OPENAI_API_KEY (+ Supabase keys for sign-in)
npm start                     # http://localhost:3000
```

`npm start` runs a small Express server that mounts the same `/api` functions
and serves `public/`, so local dev matches production. (You can also use
`vercel dev` if you have the Vercel CLI.)

Without Supabase configured, the app runs in **open/demo mode** (no sign-in).

---

## Deploy to Vercel

1. Push this repo to GitHub and **import it** at
   [vercel.com/new](https://vercel.com/new) (or run `vercel`). The included
   `vercel.json` serves `public/` statically and builds the `/api` functions.
2. In **Project → Settings → Environment Variables**, add:
   | Variable | Required | Notes |
   |----------|----------|-------|
   | `OPENAI_API_KEY` | ✅ | Needs `gpt-realtime-translate` access. Server-side only. |
   | `SUPABASE_URL` | for sign-in | Supabase project URL |
   | `SUPABASE_ANON_KEY` | for sign-in | Public anon key |
3. **Redeploy.** Then add your Vercel domain to Supabase
   **Authentication → URL Configuration → Redirect URLs** (and the Google OAuth
   authorized origins) so Google sign-in works on the deployed site.

That's it — open your `*.vercel.app` URL and start translating.

---

## Setting up Google sign-in (Supabase — free)

1. Create a free project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Google**: enable it and paste your Google
   OAuth **Client ID/Secret** from the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   - Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
   - Add your app origin(s) (e.g. `http://localhost:3000` and your Vercel URL)
     under **Authentication → URL Configuration → Redirect URLs**.
3. **Settings → API**: copy the **Project URL** and **anon public** key into your
   environment variables.

---

## Features

- One-tap mic, **spacebar** to toggle listening
- **Two-way conversation mode** — two people, two languages, push-to-talk per side
- **AI session summaries** on stop + **"Summary of all"** (language selectable, default Romanian)
- **OpenAI balance tracker** (estimate) with low-balance warnings + a top-up link
- **PDF export** of a session (transcript + summary) and optional **cloud sync** of history
- Source + target **live captions** (large, readable, scrollable)
- **Presentation mode** — fullscreen captions for translating to a room
- **Adjustable caption size** (A− / A+)
- **Light / dark theme** toggle (remembered)
- **Microphone device picker**
- **Session history** — past sessions auto-saved on-device; reopen or delete
- **Installable app (PWA)** — one-tap **Install** button (Menu → Get the app) with
  real home-screen icons on Android & iPhone, offline app shell
- **Language swap** + remembers your last-used languages
- **Mic level meter** and live **status** indicator
- **Captions-only mode** (mute translated audio) + volume control
- **Session timer** and **live cost estimate** ($0.034/min, per docs)
- **Copy** / **download (.txt)** the transcript
- **Google sign-in** (Supabase) with your API key kept server-side
- Responsive, accessible (ARIA live regions, reduced-motion, high contrast)

---

## Project structure

```
LiveTranslation/
├── api/
│   ├── token.js          # Serverless: verify user + mint ephemeral token
│   └── config.js         # Serverless: public runtime config
├── public/
│   ├── index.html        # App shell (auth + translation views)
│   ├── styles.css        # Design system (tokens + components)
│   ├── app.js            # WebRTC client: mic, captions, audio, controls
│   ├── auth.js           # Supabase Google sign-in
│   └── languages.js      # Documented input/output languages
├── supabase/schema.sql   # Optional: sessions table + RLS (for saved history)
├── server.js             # Local dev server (mounts /api + serves public)
├── vercel.json           # Static + functions config
├── .env.example
└── package.json
```

---

## Cloud sync (optional)

History + summaries are stored on-device by default. To sync them across a
user's devices, create the `sessions` table once: Supabase → **SQL Editor** →
paste [`supabase/schema.sql`](supabase/schema.sql) → **Run** (or `supabase db
push`). The app auto-detects the table and starts syncing each signed-in user's
sessions, protected by Row-Level Security (users only see their own). The
summary model is configurable via `SUMMARY_MODEL` (default `gpt-4o-mini`).

## Access & spend controls

Because the app spends a real OpenAI key, every API route is guarded server-side
(`lib/guard.js`) before any OpenAI call:

| Env var | Default | Effect |
|---------|---------|--------|
| `OWNER_EMAIL` | `semebitcoin@gmail.com` | Always allowed; the only admin who manages the in-app allowlist. |
| `ALLOWED_EMAILS` | none | Extra static allowlist. `*` = anyone signed in; or a comma-separated list. |
| `MAX_MINUTES_PER_USER_PER_DAY` | `0` (off) | Soft per-user daily cap on translation minutes. |
| `DAILY_BUDGET_USD` | `0` (off) | Global daily budget stop (needs `SUPABASE_SERVICE_ROLE_KEY` to measure). |

Out of the box **only the owner can spend**. The owner can whitelist others
**from inside the app** (Menu → **Access**) — run
[`supabase/allowlist.sql`](supabase/allowlist.sql) once to enable that
(owner-only writes, enforced by RLS). Listeners on a `/?live=…` link are
**read-only** and never hit these routes. Responses also send standard security
headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`).

## Pricing

`gpt-realtime-translate` is billed by **audio duration: $0.034 / minute**
(not tokens), per the OpenAI documentation. The in-app cost meter reflects this.

---

## Notes & limitations

- The translation model is a dedicated **speech-in → speech-out** pipe, not a
  chat agent. Translation flows from the audio stream itself.
- The **target language is set when the token is minted**, so changing it
  reconnects with a fresh token (handled automatically).
- Microphone access requires **HTTPS** (Vercel provides this) or `localhost`.
- `supabase/schema.sql` is optional — included for teams who want to persist
  per-user transcript history; the app itself offers copy/download out of the box.
