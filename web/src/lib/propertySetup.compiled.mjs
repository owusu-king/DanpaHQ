/* Test-only JS mirror of propertySetup.ts, kept in step by
   src/lib/propertySetup.test.mjs. Node runs .mjs with no build step;
   propertySetup.ts is the file that ships. */

export function describePropertySetup(input) {
  // A property for sale is sold whole, and land has no water supply, meter or
  // compound to describe and nothing inside it to share, so those two steps are
  // not asked of it. Every other property is described exactly as before.
  const selling = input.purpose === "sale";
  const land = selling && input.propertyType === "land";
  // All three facts, compound included: "not stated" is where each starts.
  const details =
    land ||
    (input.waterSource !== "unknown" &&
      input.powerMeterType !== "unknown" &&
      (input.compoundType ?? "") !== "unknown");
  const documented = Boolean(input.documentState) && input.documentState !== "draft";
  const sentAlready =
    input.documentState === "submitted" || input.documentState === "under_review";

  const outstanding = input.photos?.requiredOutstanding ?? null;
  const provided = input.photos
    ? input.photos.requiredTotal - input.photos.requiredOutstanding
    : 0;
  const photographed = outstanding === 0;
  const saleMissing = input.saleMissing ?? null;

  const steps = [
    {
      key: "basics",
      title: "The property",
      summary: "What to call it, what kind it is, and where.",
      status: "done",
      detail: input.name || undefined,
    },
  ];
  if (!land) {
    steps.push({
      key: "details",
      title: "Property details",
      summary: "Water, power and the compound.",
      status: details ? "done" : "todo",
      detail: details
        ? [input.waterSource, input.powerMeterType]
            .map((value) => value.replace(/_/g, " "))
            .join(" · ")
        : undefined,
    });
  }
  if (selling) {
    steps.push({
      key: "sale",
      title: "Sale details",
      summary: "The price, the tenure, and what a buyer is buying.",
      status: saleMissing === 0 ? "done" : "todo",
      detail: saleMissing ? `${saleMissing} still needed` : undefined,
    });
  }
  steps.push({
    key: "documents",
    title: "Documents",
    summary: selling
      ? "What shows this property is yours to sell, and its title."
      : "What shows this property is yours to let.",
    status: documented ? "done" : "todo",
    detail: documented
      ? sentAlready
        ? "With our team"
        : input.documentState === "verified"
          ? "Confirmed as yours"
          : "Added"
      : undefined,
  });
  if (!land) {
    steps.push({
      key: "amenities",
      title: "What the compound has",
      summary: "Shared by everything inside — a guard, parking, a pool.",
      status: input.amenityCount === null ? "todo" : "done",
      detail:
        input.amenityCount === null
          ? undefined
          : input.amenityCount
            ? `${input.amenityCount} recorded`
            : "None selected",
    });
  }
  steps.push({
    key: "photos",
    title: "Photos",
    summary: land
      ? "The plot, its boundary and the road to it."
      : selling
        ? "The building, inside and out."
        : "The front, the wider area, and what the compound has.",
    status:
      outstanding === null
        ? "todo"
        : photographed
          ? "done"
          : provided > 0
            ? "started"
            : "todo",
    detail:
      input.photos && outstanding !== null && outstanding > 0
        ? `${provided} of ${input.photos.requiredTotal} added`
        : undefined,
  });
  steps.push({
    key: "review",
    title: "Review",
    summary: selling
      ? "Check it over, then finish creating it. It is public only once verified."
      : "Check it over, then finish creating it.",
    status: "todo",
    terminal: true,
  });
  return steps;
}

/** The property is ready for the explicit final creation action when every
 *  input checkpoint is complete.
 *
 *  The review step does not block readiness — that is
 *  the act of finishing, not a thing to have finished. */
export function isSetupComplete(steps) {
  return steps.every((step) => step.optional || step.terminal || step.status === "done");
}

/** Where somebody returning should be put down: the first thing still outstanding. */
export function resumeAt(steps) {
  const outstanding = steps.find((step) => !step.optional && !step.terminal && step.status !== "done");
  return (outstanding ?? steps[steps.length - 1]).key;
}

/** The server's shapes, in the shape this reading expects. */
