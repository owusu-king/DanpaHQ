import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const meaning = () => read("web/src/lib/homeMeaning.ts");
const webPage = () => read("web/app/home/page.tsx");
const mobileHome = () => read("mobile/src/components/home/TenantHome.tsx");
const mobileTab = () => read("mobile/app/(app)/(tabs)/index.tsx");

/** Source with comments removed, so quoted history is not read as behaviour. */
const rendered = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

/** The tenant half of the web page, which also holds the provider's home. */
function tenantWeb() {
  const source = webPage();
  const start = source.indexOf("function TenantHome(");
  assert.notEqual(start, -1, "TenantHome is missing");
  const end = source.indexOf("/* --- provider ---", start);
  assert.notEqual(end, -1, "the provider half is missing");
  return source.slice(start, end);
}

test("what Home should say is decided once, for both clients", () => {
  const strip = (source) => source.replace(/^\/\*\*[\s\S]*?\*\/\n/, "").trim();
  assert.equal(strip(meaning()), strip(read("mobile/src/homeMeaning.ts")));
  // Self-contained, so the two can be compared byte for byte.
  assert.doesNotMatch(meaning(), /^import /m);
});

test("Home adapts to the lifecycle instead of showing everyone the same cards", () => {
  // A tenant with no tenancy is shown two ways forward, not empty Rent,
  // Agreement and Home modules.
  for (const source of [tenantWeb(), mobileHome()]) {
    assert.match(source, /Find your next home/);
    assert.match(source, /Have an access code\?/);
    assert.match(source, /tenancies\.length === 0|homes\.length === 0/);
  }
  // `rentLine` and `agreementLine` return null rather than an empty card when
  // there is no lease to describe.
  assert.match(meaning(), /if \(!tenancy\.lease\) return null;/);
});

test("a total is offered, and its parts are never lost", () => {
  // The shared meaning module still answers for one tenancy at a time, and
  // still picks no "current" one to speak for the rest.
  assert.match(meaning(), /export function rentLine\(tenancy: TenancyLike\)/);
  assert.match(meaning(), /export function agreementLine\(tenancy: TenancyLike\)/);
  assert.doesNotMatch(rendered(meaning()), /currentTenancy/);

  // Web's surface now adds the homes up, which reverses the older rule that
  // nothing here was ever merged. A person with two tenancies asked what *they*
  // owe, not what each lease owes. Two things make that safe:
  //
  //   the sum is taken in minor units, never by parsing a formatted amount;
  //   every home still gets its own row with its own outstanding figure, so the
  //   total can always be traced back to its parts.
  assert.match(tenantWeb(), /function totalOwed\(/);
  assert.match(tenantWeb(), /minor \+= rent\.outstanding_minor/);
  assert.doesNotMatch(tenantWeb(), /parseAmount|amount_formatted\.replace/);
  assert.match(tenantWeb(), /Your homes/);
  assert.match(tenantWeb(), /rankHomes\(homes\)\.map\(\(tenancy\) =>/);
  assert.match(tenantWeb(), /tenancy\.rent\.outstanding_formatted/);
  // The Unit leads each row. Two tenancies in one building are otherwise two
  // rows with the same name on them.
  assert.match(tenantWeb(), /<strong>\{homeSpace\(tenancy\) \|\| tenancy\.property\.title\}<\/strong>/);

  // The payload carries the integers the sum needs.
  const tenancyApi = read("web/src/lib/tenancy.ts");
  assert.match(tenancyApi, /outstanding_minor: number/);
  assert.match(
    read("backend/apps/occupancy/tenancy_views.py"),
    /outstanding_minor = sum\(c\.outstanding_minor for c in unpaid\)/,
  );

  // Mobile offers the same total now, under the same two conditions. It was
  // the client that still merged nothing, which made it the odd one out once
  // both dashboards were drawn in one language — and the question "what do I
  // owe" is asked on a phone more often than anywhere else.
  assert.match(mobileHome(), /My homes/);
  assert.match(mobileHome(), /\.map\(\(tenancy\) => \(?\s*<HomeCard/);
  assert.match(mobileHome(), /function totalOwed\(/);
  assert.match(mobileHome(), /minor \+= rent\.outstanding_minor/);
  assert.doesNotMatch(mobileHome(), /parseAmount|amount_formatted\.replace/);
  // Every home still carries its own outstanding figure beside its own name.
  assert.match(mobileHome(), /rent\?\.outstanding_minor \? rent\.outstanding_formatted/);
  assert.match(read("mobile/src/tenancy.ts"), /outstanding_minor: number/);
});

test("attention is ranked, and says plainly when there is nothing", () => {
  // The ranked list from the shared module is what drives the panel on both
  // clients; mobile passes it to a panel of its own rather than branching in
  // place, so the length test moved inside with it.
  assert.match(tenantWeb(), /needs\.length \?/);
  assert.match(mobileHome(), /<AttentionPanel signals=\{needs\}/);
  assert.match(mobileHome(), /signals\.length \?/);

  // Both clients keep the panel in place and give it an all-clear reading, the
  // same as the provider's. It was previously hidden when empty on both; a
  // panel that vanishes leaves a hole and a reader wondering whether it failed
  // to load, and "nothing is waiting on you" is worth saying out loud.
  for (const source of [tenantWeb(), mobileHome()]) {
    assert.match(source, /Needs attention/);
    assert.match(source, /Nothing is waiting on you\./);
  }
  assert.match(tenantWeb(), /home-all-clear/);
  // Ranked, late money first: it is the only item whose cost grows.
  const order = ["rent_overdue", "agreement_offered", "viewing", "application", "join_rejected"];
  const positions = order.map((kind) => meaning().indexOf(`kind: "${kind}"`));
  for (const position of positions) assert.notEqual(position, -1);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("Home is not Explore and does not promise what does not exist", () => {
  for (const source of [tenantWeb(), mobileHome()]) {
    const body = rendered(source);
    // Discovery lives in Explore; Home links to it and lists nothing.
    assert.doesNotMatch(body, /ListingCard|searchListings|searchPublicListings/);
    // Danpa HQ has no maintenance domain, so there is no maintenance card.
    assert.doesNotMatch(body, /[Mm]aintenance/);
  }
});

test("joining a home is reachable whatever state the account is in", () => {
  // The mobile control used to sit inside a branch a provider on the tenant
  // tab never reached, which is where the missing + went. That gate is the
  // rule, and it is unchanged.
  assert.match(mobileTab(), /const tenantMode = Boolean\(me\);/);
  assert.match(tenantWeb(), /Join a home/);

  // The round "+" beside the greeting became words under the homes it joins —
  // it could have meant add a home, add a payment or add anything at all. Both
  // paths still offer it: `JoinAnother` once there are homes, and the
  // access-code half of the empty state before there are.
  assert.match(mobileHome(), /accessibilityLabel="Join another home"/);
  assert.match(mobileHome(), /<JoinAnother onJoin=\{onJoin\} \/>/);
  assert.match(mobileHome(), /function NoTenancy\(/);
  assert.match(mobileHome(), /Have an access code\?/);
});

test("an access request that was answered is finally visible", () => {
  // The only read of a join request was provider-scoped, and no notification is
  // emitted for the decision, so a rejection was silent everywhere.
  assert.match(read("backend/apps/occupancy/views.py"), /class MyJoinRequestsView/);
  assert.match(read("backend/apps/api/urls.py"), /me\/join-requests\//);
  for (const source of [tenantWeb(), mobileHome()]) {
    assert.match(source, /joinRequests/);
  }
  assert.match(meaning(), /request\.status !== "rejected"/);
});
