/**
 * How far a property is through creation, read from what the server says.
 *
 * Mirrors `web/src/lib/propertySetup.ts` deliberately, the same way
 * `verification.ts` mirrors its web twin: a provider who starts a property on
 * their phone and finishes it on a laptop has to see the same steps in the same
 * state, and the only way to guarantee that is for both to derive it from the
 * same server fields rather than each keeping a flag.
 *
 * `propertySetup.mirror.test.mjs` compares the function bodies and fails if the
 * two drift. Read the web file for why each step is answered the way it is —
 * in particular why Documents is done when a document is *recorded* rather than
 * sent, which is the whole of the creation/submission split.
 */

export type StepStatus = "done" | "started" | "todo";

export type SetupStep = {
  key: string;
  title: string;
  summary: string;
  status: StepStatus;
  detail?: string;
  optional?: boolean;
  /** The last step, which is an action rather than a piece of data. It carries
   *  no tick: marking "Review" done before somebody has been there is how the
   *  list came to show step 6 finished while step 5 was not. */
  terminal?: boolean;
};

export type PropertySetupInput = {
  /** What it is called. Set when the record is created and never blank after. */
  name: string;
  /** `unknown` until somebody says. Both default to it on a new property. */
  waterSource: string;
  powerMeterType: string;
  /** `verification.authority.state` — `draft` until a document is recorded. */
  documentState: string;
  /** Null while the condition review has not been read yet. */
  photos: { requiredTotal: number; requiredOutstanding: number; submitted: boolean; status: string } | null;
  /** Null while unread; an empty array means read and genuinely none. */
  amenityCount: number | null;
};

export function describePropertySetup(input: PropertySetupInput): SetupStep[] {
  const details = input.waterSource !== "unknown" && input.powerMeterType !== "unknown";
  const documented = Boolean(input.documentState) && input.documentState !== "draft";
  const sentAlready =
    input.documentState === "submitted" || input.documentState === "under_review";

  const outstanding = input.photos?.requiredOutstanding ?? null;
  const provided = input.photos
    ? input.photos.requiredTotal - input.photos.requiredOutstanding
    : 0;
  const photographed = outstanding === 0;

  return [
    {
      key: "basics",
      title: "The property",
      summary: "What to call it, what kind it is, and where.",
      // Always done by the time this is asked: the record cannot exist without
      // them. It is listed anyway because it *is* a step of creating a
      // property, and leaving it out is what let the first screen drift into a
      // separate "create" action with its own button, before a flow that ended
      // in a second one.
      status: "done",
      detail: input.name || undefined,
    },
    {
      key: "details",
      title: "Property details",
      summary: "Water, power and the kind of compound.",
      status: details ? "done" : "todo",
      detail: details
        ? [input.waterSource, input.powerMeterType]
            .map((value) => value.replace(/_/g, " "))
            .join(" · ")
        : undefined,
    },
    {
      key: "documents",
      title: "Documents",
      summary: "What shows this property is yours to let.",
      status: documented ? "done" : "todo",
      detail: documented
        ? sentAlready
          ? "With our team"
          : input.documentState === "verified"
            ? "Confirmed as yours"
            : "Added"
        : undefined,
    },
    {
      key: "photos",
      title: "Photos",
      summary: "Views of the building and what is around it.",
      // `started` is its own state: some photographs added is not the same as
      // none, and a provider who added two of five should see that they began.
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
    },
    {
      key: "amenities",
      title: "What the compound has",
      summary: "Shared by everything inside — a borehole, a guard, parking.",
      // Null means the checklist has not been confirmed. Zero is a deliberate
      // and valid answer, persisted by the property amenity endpoint.
      status: input.amenityCount === null ? "todo" : "done",
      detail:
        input.amenityCount === null
          ? undefined
          : input.amenityCount
            ? `${input.amenityCount} recorded`
            : "None selected",
    },
    {
      key: "review",
      title: "Review",
      summary: "Check it over, then finish creating it.",
      status: "todo",
      terminal: true,
    },
  ];
}

/** The property is ready for the explicit final creation action when every
 *  input checkpoint is complete.
 *
 *  The review step does not block readiness — that is
 *  the act of finishing, not a thing to have finished. */
export function isSetupComplete(steps: SetupStep[]): boolean {
  return steps.every((step) => step.optional || step.terminal || step.status === "done");
}

/** Where somebody returning should be put down: the first thing still outstanding. */
export function resumeAt(steps: SetupStep[]): string {
  const outstanding = steps.find((step) => !step.optional && !step.terminal && step.status !== "done");
  return (outstanding ?? steps[steps.length - 1]!).key;
}

/** The server's shapes, in the shape this reading expects. */
export function toSetupInput(
  property: {
    title: string;
    water_source: string;
    power_meter_type: string;
    verification?: { authority?: { state?: string } };
  },
  photos: {
    required_total: number;
    required_outstanding: number;
    submitted: boolean;
    status: string;
  } | null,
  amenityCount: number | null,
): PropertySetupInput {
  return {
    name: property.title,
    waterSource: property.water_source,
    powerMeterType: property.power_meter_type,
    documentState: property.verification?.authority?.state ?? "draft",
    photos: photos
      ? {
          requiredTotal: photos.required_total,
          requiredOutstanding: photos.required_outstanding,
          submitted: photos.submitted,
          status: photos.status,
        }
      : null,
    amenityCount,
  };
}
