import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_API_KEY = "test-key";

const { app } = await import("../server.js");

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
