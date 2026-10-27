import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";

const token = "test-origin-token-not-a-real-key-123456789";
test("static frontend routes stay with assets and receive framing protection", async () => {
  const response = await worker.fetch(new Request("https://trading.example/experiments"), { ASSETS: { fetch: async () => new Response("app", { headers: { "Content-Type": "text/html" } }) } });
  assert.equal(await response.text(), "app");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'self'/);
});
test("API fails closed with missing or unsafe origin configuration", async () => {
  for (const env of [{}, { ORIGIN_URL: "http://backend.example", ORIGIN_TOKEN: token }, { ORIGIN_URL: "https://user:password@backend.example", ORIGIN_TOKEN: token }, { ORIGIN_URL: "https://backend.example", ORIGIN_TOKEN: "short" }]) {
    assert.equal((await worker.fetch(new Request("https://trading.example/api/settings"), env)).status, 503);
  }
});
test("gateway proxies auth cookies and replaces caller-controlled internal headers", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (request) => {
    assert.equal(request.url, "https://backend.example/api/auth/status?x=1");
    assert.equal(request.headers.get("X-Trading-Lab-Origin-Token"), token);
    assert.equal(request.headers.get("Cookie"), "session=opaque");
    assert.equal(request.headers.get("Authorization"), null);
    assert.equal(request.headers.get("X-Forwarded-For"), "192.0.2.1");
    assert.equal(request.redirect, "manual");
    return new Response('{"authenticated":true}', { headers: { "Content-Type": "application/json", "Set-Cookie": "session=opaque; Secure; HttpOnly; SameSite=Lax" } });
  };
  try {
    const response = await worker.fetch(new Request("https://trading.example/api/auth/status?x=1", { headers: { Cookie: "session=opaque", Authorization: "spoof", "X-Trading-Lab-Origin-Token": "spoof", "X-Forwarded-For": "spoof", "CF-Connecting-IP": "192.0.2.1" } }), { ORIGIN_URL: "https://backend.example", ORIGIN_TOKEN: token });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally { globalThis.fetch = original; }
});
test("upstream redirects cannot leak the origin or forward its token elsewhere", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example" } });
  try {
    const response = await worker.fetch(new Request("https://trading.example/api/settings"), { ORIGIN_URL: "https://backend.example", ORIGIN_TOKEN: token });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Location"), null);
  } finally { globalThis.fetch = original; }
});
