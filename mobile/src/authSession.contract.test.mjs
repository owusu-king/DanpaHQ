import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "auth.tsx"),
  "utf8",
);
const apiSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "api.ts"),
  "utf8",
);

test("refresh never asks the access-token provider to authorize itself", () => {
  const refreshCall = source.match(
    /apiFetch<[\s\S]*?>\("\/auth\/refresh\/",\s*\{([\s\S]*?)\}\);/,
  );

  assert.ok(refreshCall, "the native refresh request must remain visible to this contract");
  assert.match(refreshCall[1], /anonymous:\s*true/);
  assert.match(refreshCall[1], /refresh_token:\s*refreshToken/);
});

test("a failed refresh is propagated instead of becoming an anonymous request", () => {
  const refreshFunction = source.match(
    /const refreshAccessToken[\s\S]*?const getToken/,
  )?.[0];

  assert.ok(refreshFunction, "the refresh function must remain visible to this contract");
  assert.match(refreshFunction, /throw cause/);
  assert.doesNotMatch(refreshFunction, /catch\s*\([^)]*\)[\s\S]*?return null/);
});

test("startup restores its secure snapshot when refresh is temporarily unavailable", () => {
  assert.match(source, /catch\s*\{[\s\S]*secure\.get\(REFRESH_KEY\)/);
  assert.match(source, /refreshToken && snapshot/);
  assert.match(source, /setState\(\{ status: "signed_in", me \}\)/);
});

test("the client uses the server-provided access-token lifetime", () => {
  assert.match(source, /tokens\.expires_in \?\? 15 \* 60/);
});

test("an expired bearer token is refreshed once and the request is replayed", () => {
  assert.match(apiSource, /response\.status === 401/);
  assert.match(apiSource, /authTokenProvider\(true\)/);
  assert.match(apiSource, /retriedAfterUnauthorized/);
});

test("authorization and throttling responses do not erase a valid session", () => {
  const refreshMe = source.match(/const refreshMe[\s\S]*?useEffect\(\(\) =>/i)?.[0];
  assert.ok(refreshMe, "refreshMe must remain visible to this contract");
  assert.match(refreshMe, /cause\.status === 401/);
  assert.doesNotMatch(refreshMe, /cause\.status >= 400/);

  const refusal = source.match(/function isRefreshRefusal[\s\S]*?\n\}/)?.[0];
  assert.ok(refusal, "refresh refusal classification must remain explicit");
  assert.match(refusal, /\[400, 401, 403, 422\]/);
  assert.doesNotMatch(refusal, /status >= 400/);
});
