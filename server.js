// server.js — local development server.
//
// In production the app runs on Vercel: static files from /public and the
// serverless functions in /api. This little Express server reproduces that
// locally (so you can run `npm start` without the Vercel CLI) by mounting the
// same /api handlers and serving /public.

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import tokenHandler from "./api/token.js";
import configHandler from "./api/config.js";
import summarizeHandler from "./api/summarize.js";
import askHandler from "./api/ask.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Mount the Vercel serverless handlers (they use the req/res shape Express
// also provides: req.body, res.status().json()).
app.all("/api/token", (req, res) => tokenHandler(req, res));
app.all("/api/config", (req, res) => configHandler(req, res));
app.all("/api/summarize", (req, res) => summarizeHandler(req, res));
app.all("/api/ask", (req, res) => askHandler(req, res));

app.use(express.static(path.join(__dirname, "public")));

if (!process.env.OPENAI_API_KEY) {
  console.warn("[warn] OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.");
}
if (!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)) {
  console.warn(
    "[warn] SUPABASE_URL/SUPABASE_ANON_KEY not set — using the built-in default Supabase project for sign-in."
  );
}

app.listen(PORT, () => {
  console.log(`LiveTranslation (dev) running on http://localhost:${PORT}`);
});
