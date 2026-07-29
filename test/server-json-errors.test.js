import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.OPENAI_API_KEY = "test-key";

const { app } = await import("../server.js");

test("the local server loads .env before API modules capture configuration", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "live-translation-env-"));
  const serverUrl = pathToFileURL(path.resolve("server.js")).href;
  writeFileSync(
    path.join(directory, ".env"),
    [
      "OWNER_EMAIL=owner@example.com",
      "SUPABASE_SERVICE_ROLE_KEY=service-test",
      "SUPABASE_URL=https://example.supabase.co",
      "SUPABASE_ANON_KEY=anon-test",
      "OPENAI_API_KEY=test-key",
    ].join("\n")
  );

  const environment = { ...process.env };
  for (const name of [
    "OWNER_EMAIL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "OPENAI_API_KEY",
  ]) {
    delete environment[name];
  }

  const script = `
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).startsWith("http://127.0.0.1:")) return nativeFetch(url, options);
      if (String(url).endsWith("/auth/v1/user")) {
        if (options.headers.apikey !== "anon-test") throw new Error("wrong anon key");
        return Response.json({ email: "owner@example.com" });
      }
      if (String(url).includes("/rest/v1/app_allowlist")) {
        if (options.headers.apikey !== "service-test") throw new Error("wrong service key");
        return Response.json([]);
      }
      throw new Error("unexpected request: " + url);
    };
    const { app } = await import(${JSON.stringify(serverUrl)});
    const server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/allowlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "owner-token", action: "list-allowlist" }),
    });
    const payload = await response.json();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (response.status !== 200 || !Array.isArray(payload)) {
      throw new Error("unexpected response: " + response.status + " " + JSON.stringify(payload));
    }
  `;

  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the real Express boundary returns structured JSON for malformed request bodies", async (t) => {
  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const { port } = server.address();
  for (const endpoint of ["token", "summarize", "ask"]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    assert.equal(response.status, 400, endpoint);
    assert.match(response.headers.get("content-type"), /^application\/json\b/, endpoint);
    assert.deepEqual(await response.json(), { error: "Request body must contain valid JSON." }, endpoint);
  }
});
