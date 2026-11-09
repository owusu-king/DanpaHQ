import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../../functions/api/portfolio-home/[organizationId].js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const path = `/api/portfolio-home/${organizationId}`;
const url = `https://staging.danpahq.com${path}`;
const bearer = { Authorization: "Bearer staging-test-token" };

test("the Home proxy forwards only the bearer and tracing headers and returns a private response", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (target, init) => {
    assert.equal(target, `https://api-staging.danpahq.com/api/v1/organizations/${organizationId}/portfolio/?view=home`);
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(Object.fromEntries(init.headers), {
      authorization: bearer.Authorization,
      "x-client": "web",
      "x-request-id": "request-test",
    });
    return Response.json({ counts: { properties: 2 } }, { headers: {
      "Cache-Control": "public, max-age=60",
      "Server-Timing": "app;dur=28",
      "Set-Cookie": "private=value",
      "X-Request-ID": "request-test",
    } });
  });
  const response = await onRequest({
    request: new Request(`${url}?upstream=https://example.com`, { headers: {
      ...bearer, Cookie: "session=private", "X-Request-ID": "request-test",
    } }),
    params: { organizationId },
  });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Server-Timing"), "app;dur=28");
  assert.equal(response.headers.get("X-Request-ID"), "request-test");
  assert.equal(response.headers.has("Set-Cookie"), false);
  assert.deepEqual(await response.json(), { counts: { properties: 2 } });
});

test("only the staging hostname, a UUID and authenticated GET can reach Django", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch");
  for (const [request, id, status] of [
    [new Request(`https://danpahq.com${path}`, { headers: bearer }), organizationId, 404],
    [new Request(url, { headers: bearer }), "../elsewhere", 404],
    [new Request(url, { method: "POST", headers: bearer }), organizationId, 405],
    [new Request(url, { headers: { Cookie: "session=private" } }), organizationId, 401],
  ]) {
    const response = await onRequest({ request, params: { organizationId: id } });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("upstream authentication errors survive and redirects cannot forward credentials", async (t) => {
  const request = new Request(url, { headers: bearer });
  const input = { request, params: { organizationId } };
  const denied = { error: { code: "not_authenticated", message: "Sign in to continue." } };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(denied, { status: 401 }));
  fetch.mock.mockImplementationOnce(async () => Response.redirect("https://example.com/"));
  const redirect = await onRequest(input);
  assert.equal(redirect.status, 502);
  assert.equal(redirect.headers.has("Location"), false);
  const response = await onRequest(input);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), denied);
});

test("the proxy does not serve an upstream HTML page under the website origin", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>unexpected</html>", {
    headers: { "Content-Type": "text/html" },
  }));
  const response = await onRequest({ request: new Request(url, { headers: bearer }), params: { organizationId } });
  assert.equal(response.status, 502);
  assert.equal(await response.text(), "");
});
