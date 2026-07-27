import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("owner allowlist UI uses the authenticated same-origin server endpoint", () => {
  const start = appSource.indexOf("async function renderAllowlist()");
  const end = appSource.indexOf("async function renderSigninList", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const renderAllowlist = appSource.slice(start, end);
  assert.match(renderAllowlist, /ownerAccess\("list-allowlist"\)/);
  assert.doesNotMatch(renderAllowlist, /supabaseUrl|supabaseAnonKey|SERVICE_ROLE/i);
});

test("owner endpoint calls carry the user's access token but no privileged credential", () => {
  const start = appSource.indexOf("async function ownerAccess(");
  const end = appSource.indexOf("function closeMenu", start);
  const ownerAccess = appSource.slice(start, end);

  assert.match(ownerAccess, /const accessToken = await getAccessToken\(\)/);
  assert.match(ownerAccess, /fetch\("\/api\/allowlist"/);
  assert.doesNotMatch(ownerAccess, /apikey|SERVICE_ROLE|service.role/i);
});
