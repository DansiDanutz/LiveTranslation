import assert from "node:assert/strict";
import test from "node:test";

process.env.OWNER_EMAIL = "configured-owner@example.com";
process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-test-key";

const originalFetch = globalThis.fetch;
const { default: handler } = await import(`../api/allowlist.js?test=${Date.now()}`);

function response() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("configured owner is authenticated before service-role allowlist access", async () => {
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes("/auth/v1/user")) {
      return { ok: true, json: async () => ({ email: "configured-owner@example.com" }) };
    }
    return { ok: true, status: 200, json: async () => [{ email: "allowed@example.com" }] };
  };

  const res = response();
  await handler({ method: "POST", body: { action: "list-allowlist", accessToken: "owner-jwt" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, [{ email: "allowed@example.com" }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Authorization, "Bearer owner-jwt");
  assert.equal(requests[1].options.headers.Authorization, "Bearer server-only-test-key");
  assert.equal(requests[1].options.headers.apikey, "server-only-test-key");
});

test("non-owner JWT cannot reach service-role storage", async () => {
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ email: "attacker@example.com" }) };
  };

  const res = response();
  await handler({ method: "POST", body: { action: "list-allowlist", accessToken: "attacker-jwt" } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(requests.length, 1);
});
