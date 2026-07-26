import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("owner allowlist reads send the signed-in user's JWT", () => {
  const start = appSource.indexOf("async function renderAllowlist()");
  const end = appSource.indexOf("async function renderSigninList", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const renderAllowlist = appSource.slice(start, end);
  assert.match(renderAllowlist, /app_allowlist\?select=email[^]*headers: await cloudHeaders\(\)/);
  assert.doesNotMatch(renderAllowlist, /headers:\s*\{\s*apikey:\s*config\.supabaseAnonKey\s*\}/);
});

test("browser authentication uses only the anon key and the user's access token", () => {
  const start = appSource.indexOf("async function cloudHeaders()");
  const end = appSource.indexOf("async function cloudSyncUp", start);
  const cloudHeaders = appSource.slice(start, end);

  assert.match(cloudHeaders, /const token = await getAccessToken\(\)/);
  assert.match(cloudHeaders, /apikey: config\.supabaseAnonKey/);
  assert.match(cloudHeaders, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(cloudHeaders, /SERVICE_ROLE|service.role/i);
});
