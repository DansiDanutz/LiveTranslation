// server.js — local development server.
//
// In production the app runs on Vercel: static files from /public and the
// serverless functions in /api. This little Express server reproduces that
// locally (so you can run `npm start` without the Vercel CLI) by mounting the
// same /api handlers and serving /public.

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import tokenHandler from "./api/token.js";
import configHandler from "./api/config.js";
import summarizeHandler from "./api/summarize.js";
import askHandler from "./api/ask.js";
import allowlistHandler from "./api/allowlist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use((error, _req, res, next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must contain valid JSON." });
  }
  return next(error);
});

// Mount the Vercel serverless handlers (they use the req/res shape Express
// also provides: req.body, res.status().json()).
app.all("/api/token", (req, res) => tokenHandler(req, res));
app.all("/api/config", (req, res) => configHandler(req, res));
app.all("/api/summarize", (req, res) => summarizeHandler(req, res));
app.all("/api/ask", (req, res) => askHandler(req, res));
app.all("/api/allowlist", (req, res) => allowlistHandler(req, res));

app.use(express.static(path.join(__dirname, "public")));

if (!process.env.OPENAI_API_KEY) {
  console.warn("[warn] OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.");
}
if (!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)) {
  console.warn(
    "[warn] SUPABASE_URL/SUPABASE_ANON_KEY not set — using the built-in default Supabase project for sign-in."
  );
}

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`LiveTranslation (dev) running on http://localhost:${PORT}`);
  });
}
