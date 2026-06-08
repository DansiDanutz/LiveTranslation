// test/smoke.cjs — headless smoke test run in CI.
// Boots the local server in demo mode (no Supabase) and asserts the app
// renders correctly: the app view shows, the auth view is actually hidden
// (regression guard for the "both views rendered / stuck on login" bug), and
// the documented endpoints respond.

const { spawn } = require("node:child_process");
const path = require("node:path");
const puppeteer = require("puppeteer");

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

function assert(cond, msg) {
  if (!cond) throw new Error("FAILED: " + msg);
  console.log("  ✓ " + msg);
}

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

(async () => {
  const server = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), OPENAI_API_KEY: "sk-ci-dummy", SUPABASE_URL: "", SUPABASE_ANON_KEY: "" },
    stdio: "inherit",
  });

  let code = 0;
  let browser;
  try {
    await waitForServer();

    // --- API checks ---
    const cfg = await fetch(`${BASE}/api/config`).then((r) => r.json());
    assert(cfg.keyConfigured === true, "/api/config reports key configured");
    assert(typeof cfg.authRequired === "boolean", "/api/config has authRequired");
    assert(cfg.model === "gpt-realtime-translate", "model is gpt-realtime-translate");

    const tokenResp = await fetch(`${BASE}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "es", accessToken: "demo" }),
    });
    assert(tokenResp.status >= 200, "/api/token responds");

    // --- Browser checks ---
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 1500));

    const view = await page.evaluate(() => ({
      app: getComputedStyle(document.getElementById("app-view")).display,
      auth: getComputedStyle(document.getElementById("auth-view")).display,
    }));
    const bodyText = await page.evaluate(() => document.body.innerText);

    // The core regression guard: the login bug rendered BOTH views at once.
    const appVisible = view.app !== "none";
    const authVisible = view.auth !== "none";
    assert(appVisible !== authVisible, "exactly one view visible (no login/app overlap)");

    if (cfg.authRequired) {
      assert(authVisible && !appVisible, "login screen shown, app hidden (auth required)");
      assert(/Continue with Google/.test(bodyText), "Google sign-in button present");
    } else {
      assert(appVisible && !authVisible, "app shown, login hidden (demo mode)");
      assert(/Tap to start translating/.test(bodyText), "translator controls rendered");
    }

    console.log("\nSMOKE TEST PASSED ✅");
  } catch (err) {
    console.error("\nSMOKE TEST FAILED ❌:", err.message);
    code = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
    process.exit(code);
  }
})();
