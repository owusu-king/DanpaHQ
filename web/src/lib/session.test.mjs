import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiFailure,
  isRefusal,
  shouldRestoreSession,
  stateAfterFailure,
} from "./session.compiled.mjs";

/**
 * Session initialization has two independent decisions: whether this route
 * needs a restore attempt, and what a failed attempt means. These tests pin the
 * boundary so a public visitor does not create auth traffic and a malformed or
 * unavailable API does not masquerade as a logout.
 */

const ME = { display_name: "Kwame Owusu" };
const SIGNED_IN = { status: "signed_in", me: ME };

test("the API's actual session refusals sign you out", () => {
  for (const failure of [
    new ApiFailure(401, "not_authenticated"),
    new ApiFailure(401, "authentication_failed"),
    new ApiFailure(403, "permission_denied"),
    // /auth/refresh/ with neither its HttpOnly cookie nor a body token.
    new ApiFailure(422, "validation_failed", {}),
  ]) {
    assert.deepEqual(
      stateAfterFailure(failure, SIGNED_IN),
      { status: "signed_out" },
      `${failure.status}/${failure.error.code} should end the session`,
    );
  }
});

test("malformed and unexpected client responses are not treated as logout", () => {
  for (const failure of [
    new ApiFailure(400, "request_failed"),
    new ApiFailure(404, "not_found"),
    new ApiFailure(409, "conflict"),
    new ApiFailure(422, "validation_failed", { fields: { platform: ["invalid"] } }),
  ]) {
    const next = stateAfterFailure(failure, SIGNED_IN);
    assert.equal(next.status, "signed_in");
    assert.equal(next.stale, true);
    assert.ok(!isRefusal(failure));
  }
});

test("an unreachable service keeps the session, marked stale", () => {
  const next = stateAfterFailure(new ApiFailure(0, "network_error"), SIGNED_IN);

  assert.equal(next.status, "signed_in");
  assert.equal(next.me, ME, "the identity we already had is kept");
  assert.equal(next.stale, true);
});

test("a server fault keeps the session too", () => {
  for (const status of [500, 502, 503, 504]) {
    const next = stateAfterFailure(new ApiFailure(status, "server_error"), SIGNED_IN);
    assert.equal(next.status, "signed_in", `${status} must not sign anyone out`);
    assert.equal(next.stale, true);
  }
});

test("a thrown non-ApiFailure is not a logout either", () => {
  const next = stateAfterFailure(new TypeError("network"), SIGNED_IN);
  assert.equal(next.status, "signed_in");
  assert.equal(next.stale, true);
});

test("with nobody signed in yet, unreachable is its own state", () => {
  assert.deepEqual(
    stateAfterFailure(new ApiFailure(0, "network_error"), { status: "loading" }),
    { status: "unavailable" },
  );
  assert.deepEqual(
    stateAfterFailure(new ApiFailure(503, "server_error"), { status: "unavailable" }),
    { status: "unavailable" },
  );
});

test("a cold load that is refused is a genuine signed-out", () => {
  assert.deepEqual(
    stateAfterFailure(new ApiFailure(401, "not_authenticated"), { status: "loading" }),
    { status: "signed_out" },
  );
});

test("isRefusal separates an auth answer from other failures", () => {
  assert.ok(isRefusal(new ApiFailure(401, "not_authenticated")));
  assert.ok(!isRefusal(new ApiFailure(0, "network_error")));
  assert.ok(!isRefusal(new ApiFailure(500, "server_error")));
  assert.ok(!isRefusal(new TypeError("network")));
});

test("public startup restores only a browser that has a session hint", () => {
  assert.equal(shouldRestoreSession(false, null), false);
  assert.equal(shouldRestoreSession(false, "0"), false);
  assert.equal(shouldRestoreSession(false, "1"), true);
  assert.equal(shouldRestoreSession(true, null), true, "protected routes always verify once");
});
