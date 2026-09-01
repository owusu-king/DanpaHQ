import test from "node:test";
import assert from "node:assert/strict";

import { ApiFailure, isRefusal, stateAfterFailure } from "./session.compiled.mjs";

/**
 * The reported bug, pinned.
 *
 * A signed-in person reloading their portal during an API restart was landing
 * on a blank page, because every failure of `/me/` — including "we could not
 * reach the server" — was read as "this person is signed out". These tests hold
 * the line mobile has held since Phase 1: only a refusal is a logout.
 */

const ME = { display_name: "Kwame Owusu" };
const SIGNED_IN = { status: "signed_in", me: ME };

test("a refusal signs you out", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.deepEqual(
      stateAfterFailure(new ApiFailure(status), SIGNED_IN),
      { status: "signed_out" },
      `${status} should end the session`,
    );
  }
});

test("an unreachable service keeps the session, marked stale", () => {
  // status 0 is the client's own "could not reach it".
  const next = stateAfterFailure(new ApiFailure(0), SIGNED_IN);

  assert.equal(next.status, "signed_in");
  assert.equal(next.me, ME, "the identity we already had is kept");
  assert.equal(next.stale, true);
});

test("a server fault keeps the session too", () => {
  // A restarting service answers 502 for a few seconds. Nobody signed out.
  for (const status of [500, 502, 503, 504]) {
    const next = stateAfterFailure(new ApiFailure(status), SIGNED_IN);
    assert.equal(next.status, "signed_in", `${status} must not sign anyone out`);
    assert.equal(next.stale, true);
  }
});

test("a thrown non-ApiFailure is not a logout either", () => {
  // A TypeError from fetch says nothing about the account.
  const next = stateAfterFailure(new TypeError("network"), SIGNED_IN);
  assert.equal(next.status, "signed_in");
  assert.equal(next.stale, true);
});

test("with nobody signed in yet, unreachable is its own state", () => {
  // A cold load during an outage. There is no identity to keep, but claiming
  // they are signed out would be a guess — and the wrong one, usually.
  assert.deepEqual(
    stateAfterFailure(new ApiFailure(0), { status: "loading" }),
    { status: "unavailable" },
  );
  assert.deepEqual(
    stateAfterFailure(new ApiFailure(503), { status: "unavailable" }),
    { status: "unavailable" },
  );
});

test("a cold load that is refused is a genuine signed-out", () => {
  assert.deepEqual(
    stateAfterFailure(new ApiFailure(401), { status: "loading" }),
    { status: "signed_out" },
  );
});

test("isRefusal separates an answer from the absence of one", () => {
  assert.ok(isRefusal(new ApiFailure(401)));
  assert.ok(!isRefusal(new ApiFailure(0)));
  assert.ok(!isRefusal(new ApiFailure(500)));
  assert.ok(!isRefusal(new TypeError("network")));
});
