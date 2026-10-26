import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiFailure,
  fieldErrorsFrom,
  isAccountExists,
  summaryErrorFrom,
} from "./formErrors.compiled.mjs";

function failure({ code = "validation_failed", message = "Some of the details need fixing.", details = {}, status = 422 } = {}) {
  return new ApiFailure({ code, message, details, requestId: "test" }, status);
}

test("an existing account on sign-up is recognised by code and status", () => {
  const refusal = failure({
    code: "ACCOUNT_EXISTS",
    message: "This number already has an account.",
    status: 409,
  });
  assert.equal(isAccountExists(refusal), true);
});

test("nothing else is mistaken for an existing account", () => {
  // Right status, wrong code: a plain conflict must still read as an error.
  assert.equal(isAccountExists(failure({ code: "conflict", status: 409 })), false);
  // Right code, wrong status: the pair is the contract, not either half.
  assert.equal(isAccountExists(failure({ code: "ACCOUNT_EXISTS", status: 422 })), false);
  assert.equal(isAccountExists(failure()), false);
  assert.equal(isAccountExists(new Error("network down")), false);
  assert.equal(isAccountExists(null), false);
});

test("field errors are unpacked and joined per field", () => {
  const fields = fieldErrorsFrom(
    failure({
      details: {
        fields: {
          password: ["This password is too short.", "This password is entirely numeric."],
          date_of_birth: ["You must be at least 18 to hold an account."],
        },
      },
    }),
  );

  assert.deepEqual(Object.keys(fields).sort(), ["date_of_birth", "password"]);
  assert.equal(fields.password, "This password is too short. This password is entirely numeric.");
});

test("a failure with no field detail yields none", () => {
  assert.deepEqual(fieldErrorsFrom(failure()), {});
  assert.deepEqual(fieldErrorsFrom(failure({ details: { fields: [] } })), {});
  assert.deepEqual(fieldErrorsFrom(new Error("offline")), {});
});

test("the summary defers to the fields when there are any", () => {
  const withFields = failure({ details: { fields: { password: ["Too short."] } } });
  assert.equal(summaryErrorFrom(withFields, fieldErrorsFrom(withFields)), "");

  const withoutFields = failure({ message: "That code did not work." });
  assert.equal(summaryErrorFrom(withoutFields, {}), "That code did not work.");
});

test("a non-API failure still says something", () => {
  assert.equal(summaryErrorFrom(new Error("boom"), {}), "Something went wrong. Try again.");
});
