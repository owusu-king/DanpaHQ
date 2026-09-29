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
  /** `sale` for a property sold whole. Absent means letting. */
  purpose?: string;
  /** The category — `land` is described differently from a building. */
  propertyType?: string;
  /** How many sale details are still needed; null while unread. Sale only. */
  saleMissing?: number | null;
};

export function describePropertySetup(input: PropertySetupInput): SetupStep[] {
  // A property for sale is sold whole, and land has no water supply, meter or
  // compound to describe and nothing inside it to share, so those two steps are
  // not asked of it. Every other property is described exactly as before.
  const selling = input.purpose === "sale";
  const land = selling && input.propertyType === "land";
  const details = land || (input.waterSource !== "unknown" && input.powerMeterType !== "unknown");
  const documented = Boolean(input.documentState) && input.documentState !== "draft";
  const sentAlready =
    input.documentState === "submitted" || input.documentState === "under_review";

  const outstanding = input.photos?.requiredOutstanding ?? null;
  const provided = input.photos
    ? input.photos.requiredTotal - input.photos.requiredOutstanding
    : 0;
  const photographed = outstanding === 0;
  const saleMissing = input.saleMissing ?? null;

  const steps: SetupStep[] = [
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
      summary: "Water, power and the kind of compound.",
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
  steps.push(
    {
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
    },
    {
      key: "photos",
      title: "Photos",
      summary: land
        ? "The plot, its boundary and the road to it."
        : selling
          ? "The building, inside and out."
          : "Views of the building and what is around it.",
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
  );
  if (!land) {
    steps.push({
      key: "amenities",
      title: "What the compound has",
      summary: "Shared by everything inside — a borehole, a guard, parking.",
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
    purpose?: string;
    property_type?: string;
  },
  photos: {
    required_total: number;
    required_outstanding: number;
    submitted: boolean;
    status: string;
  } | null,
  amenityCount: number | null,
  /** A sale's outstanding details, from `/properties/<id>/sale/`; null while unread. */
  saleMissing: number | null = null,
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
    purpose: property.purpose,
    propertyType: property.property_type,
    saleMissing,
  };
}
