import assert from "node:assert/strict";
import test from "node:test";

import {
  describePropertySetup,
  isSetupComplete,
  resumeAt,
} from "./propertySetup.compiled.mjs";

/**
 * The complaint this answers: creating a property dropped somebody onto a
 * management page with every section on it and no sense of what was left. The
 * flow that replaces it and the property page that routes into it both read
 * these functions, so the two cannot disagree about what is finished.
 */

/** A property the moment it is created: nothing described, nothing sent. */
const fresh = {
  name: "Adom Court",
  waterSource: "unknown",
  powerMeterType: "unknown",
  documentState: "draft",
  photos: { requiredTotal: 3, requiredOutstanding: 3, submitted: false, status: "not_started" },
  amenityCount: null,
};

const byKey = (steps) => Object.fromEntries(steps.map((step) => [step.key, step]));

test("a new property has everything to do", () => {
  const steps = describePropertySetup(fresh);

  assert.deepEqual(
    steps.map((step) => step.key),
    ["basics", "details", "documents", "photos", "amenities", "review"],
  );
  // Except the first, which is done the moment the record exists — you cannot
  // have a property without a name, a kind and an address.
  assert.equal(byKey(steps).basics.status, "done");
  assert.ok(steps.filter((step) => step.key !== "basics").every((s) => s.status === "todo"));
  assert.equal(isSetupComplete(steps), false);
});

test("details are done once water and power are answered", () => {
  const before = byKey(describePropertySetup(fresh));
  assert.equal(before.details.status, "todo");

  const after = byKey(
    describePropertySetup({ ...fresh, waterSource: "borehole", powerMeterType: "prepaid" }),
  );

  assert.equal(after.details.status, "done");
  // Said back, so the step is not a bare tick nobody can check.
  assert.equal(after.details.detail, "borehole · prepaid");
});

test("one answer is not both", () => {
  // `unknown` is not a shrug — the evidence policy reads these, and a property
  // that has answered only one is still producing a guessed checklist.
  const steps = byKey(describePropertySetup({ ...fresh, waterSource: "borehole" }));

  assert.equal(steps.details.status, "todo");
});

test("photographs in progress are neither done nor untouched", () => {
  const steps = byKey(
    describePropertySetup({
      ...fresh,
      photos: { requiredTotal: 5, requiredOutstanding: 3, submitted: false, status: "pending" },
    }),
  );

  assert.equal(steps.photos.status, "started");
  assert.equal(steps.photos.detail, "2 of 5 added");
});

test("a document that has been recorded is done, sent or not", () => {
  // The heart of the split. Recording the document used to be the same act as
  // filing it for review, so the second step of creation submitted the property
  // and the last step had only photographs left to send. Held counts as done.
  const held = byKey(describePropertySetup({ ...fresh, documentState: "ready_for_submission" }));
  assert.equal(held.documents.status, "done");
  assert.equal(held.documents.detail, "Added");

  const sent = byKey(describePropertySetup({ ...fresh, documentState: "submitted" }));
  assert.equal(sent.documents.status, "done");
  assert.equal(sent.documents.detail, "With our team");
});

test("amenities require an explicit answer, including none", () => {
  const unanswered = describePropertySetup({
    ...fresh,
    waterSource: "borehole",
    powerMeterType: "prepaid",
    documentState: "submitted",
    photos: { requiredTotal: 3, requiredOutstanding: 0, submitted: true, status: "pending" },
  });
  assert.equal(byKey(unanswered).amenities.status, "todo");
  assert.equal(isSetupComplete(unanswered), false);

  const answeredNone = describePropertySetup({
    ...fresh,
    waterSource: "borehole",
    powerMeterType: "prepaid",
    documentState: "submitted",
    photos: { requiredTotal: 3, requiredOutstanding: 0, submitted: true, status: "pending" },
    amenityCount: 0,
  });

  assert.equal(byKey(answeredNone).amenities.status, "done");
  assert.equal(byKey(answeredNone).amenities.detail, "None selected");
  assert.equal(byKey(answeredNone).amenities.optional, undefined);
  assert.equal(isSetupComplete(answeredNone), true);
});

test("creation is complete when the inputs are in, not when they are sent", () => {
  // Everything the property needs, nothing submitted. This is the state the
  // wizard's last step leaves behind, and it has to read as finished — the
  // provider has created a property; whether to send it is the next decision.
  const created = describePropertySetup({
    name: "Adom Court",
    waterSource: "estate",
    powerMeterType: "postpaid",
    documentState: "ready_for_submission",
    photos: { requiredTotal: 3, requiredOutstanding: 0, submitted: false, status: "pending" },
    amenityCount: 2,
  });

  assert.equal(isSetupComplete(created), true);
  // Review carries no tick, ever. It is the act of finishing rather than a
  // thing to have finished, and ticking it as soon as the photographs landed is
  // how the list came to show step 6 done above an untouched step 5.
  assert.equal(byKey(created).review.status, "todo");
  assert.equal(byKey(created).review.terminal, true);
});

test("a confirmed empty amenity checklist does not become outstanding again", () => {
  const finished = describePropertySetup({
    name: "Adom Court",
    waterSource: "estate",
    powerMeterType: "postpaid",
    documentState: "ready_for_submission",
    photos: { requiredTotal: 3, requiredOutstanding: 0, submitted: false, status: "pending" },
    amenityCount: 0,
  });

  assert.equal(byKey(finished).amenities.status, "done");
  assert.equal(isSetupComplete(finished), true);
  assert.notEqual(resumeAt(finished), "amenities");
});

test("a missing document is not made up for by a full photo album", () => {
  const steps = describePropertySetup({
    ...fresh,
    waterSource: "estate",
    powerMeterType: "postpaid",
    photos: { requiredTotal: 3, requiredOutstanding: 0, submitted: false, status: "pending" },
  });

  assert.equal(byKey(steps).photos.status, "done");
  assert.equal(byKey(steps).documents.status, "todo");
  assert.equal(isSetupComplete(steps), false);
});

test("resuming lands on the first thing outstanding", () => {
  // Somebody coming back to a half-finished property is coming back *to* the
  // unfinished part; making them find it is the whole complaint.
  assert.equal(resumeAt(describePropertySetup(fresh)), "details");

  assert.equal(
    resumeAt(
      describePropertySetup({
        ...fresh,
        waterSource: "borehole",
        powerMeterType: "prepaid",
      }),
    ),
    "documents",
  );

  assert.equal(
    resumeAt(
      describePropertySetup({
        ...fresh,
        waterSource: "borehole",
        powerMeterType: "prepaid",
        documentState: "submitted",
      }),
    ),
    "photos",
  );
});

test("nothing is lost between visits, because nothing is held here", () => {
  // The same server state in, the same steps out — which is what makes "save
  // for later" a link rather than a feature.
  const halfway = {
    ...fresh,
    waterSource: "sachet",
    powerMeterType: "shared",
    documentState: "submitted",
    photos: { requiredTotal: 5, requiredOutstanding: 2, submitted: false, status: "pending" },
    amenityCount: 1,
  };

  assert.deepEqual(describePropertySetup(halfway), describePropertySetup(halfway));
  assert.equal(resumeAt(describePropertySetup(halfway)), "photos");
});
