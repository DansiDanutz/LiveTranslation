import assert from "node:assert/strict";
import test from "node:test";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("DB allowlist is not queried without a server-only service key", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ id: "user-1", email: "guest@example.com" }) };
  };

  const { guardLight } = await import(`../lib/guard.js?without-service=${Date.now()}`);
  const result = await guardLight("user-token");

  assert.equal(result.status, 403);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/auth\/v1\/user$/);
});

test("DB allowlist lookup uses service-role authorization", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, headers: options.headers });
    if (url.includes("/auth/v1/user")) {
      return { ok: true, json: async () => ({ id: "user-2", email: "allowed@example.com" }) };
    }
    return { ok: true, json: async () => [{ email: "allowed@example.com" }] };
  };

  const { guardLight } = await import(`../lib/guard.js?with-service=${Date.now()}`);
  const result = await guardLight("user-token");

  assert.equal(result.user.email, "allowed@example.com");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.apikey, "service-test-key");
  assert.equal(requests[1].headers.Authorization, "Bearer service-test-key");
});
