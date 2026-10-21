/**
 * The artisan experience on mobile: earned, four tabs, and nothing beyond them.
 *
 * Three failures this guards against. An address reaching the artisan tabs
 * without an approved application (the backend refuses every request behind
 * them, but the shell must not draw them either). A fifth tab creeping in — a
 * Menu, a Properties — that would show an artisan more than their own work.
 * And a tab route sharing an address with the renter's, which a group in
 * parentheses does not prevent.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("only an approved artisan who chose the experience is shown the artisan tabs", () => {
  const gate = code(read("app/_layout.tsx"));

  assert.match(gate, /const inArtisanTabs = group === "\(app\)" && screen === "\(artisan-tabs\)";/);
  assert.match(gate, /const mayWork = capabilities\.artisan\.workspace_access && capabilities\.active_workspace === "artisan";/);
  assert.match(gate, /if \(inArtisanTabs && !mayWork && !destination\.startsWith\("\/\(app\)\/\(artisan-tabs\)"\)\) \{\s*return destination;/);
  // A stored context can never route somebody into tabs they cannot open.
  assert.match(code(read("src/navigation.ts")), /if \(route === "\/\(app\)\/\(artisan-tabs\)"\) return me\.capabilities\.artisan\.workspace_access;/);
});

test("the artisan tabs are Home, Requests, Jobs and My Profile, on both platforms", () => {
  const layout = code(read("app/(app)/(artisan-tabs)/_layout.tsx"));
  const native = [...layout.matchAll(/<NativeTabs\.Trigger name="([^"]+)"/g)].map((match) => match[1]);
  const js = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1]);
  const expected = ["index", "artisan-requests", "artisan-jobs", "artisan-profile"];

  assert.deepEqual(native, expected);
  assert.deepEqual(js, expected);
  for (const label of ["Home", "Requests", "Jobs", "My Profile"]) {
    assert.match(layout, new RegExp(`<NativeTabs\\.Trigger\\.Label>${label}</NativeTabs\\.Trigger\\.Label>`));
    assert.match(layout, new RegExp(`tabBarLabel: "${label}"`));
  }
});

test("no artisan tab shares an address with the renter's or the provider's", () => {
  const artisan = code(read("app/(app)/(artisan-tabs)/_layout.tsx"));
  const others = code(read("app/(app)/(tabs)/_layout.tsx")) + code(read("app/(app)/(provider-tabs)/_layout.tsx"));
  const names = (source) => new Set([...source.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1]));
  const shared = [...names(artisan)].filter((name) => name !== "index" && names(others).has(name));

  assert.deepEqual(shared, []);
});

test("the artisan screens frame each tab and leave the way out on My Profile", () => {
  for (const [file, tab, screen] of [
    ["index", "home", "ArtisanHomeScreen"],
    ["artisan-requests", "requests", "ArtisanRequestsScreen"],
    ["artisan-jobs", "jobs", "ArtisanJobsScreen"],
    ["artisan-profile", "profile", "ArtisanProfileScreen"],
  ]) {
    const source = code(read(`app/(app)/(artisan-tabs)/${file}.tsx`));
    assert.match(source, new RegExp(`<ArtisanTabFrame tab="${tab}">\\s*<${screen} />`));
  }

  const screens = code(read("src/components/artisan/ArtisanScreens.tsx"));
  // My Profile is the only page with the crossings, and it offers only what
  // the backend says is open.
  assert.match(screens, /\(me\?\.capabilities\.available_workspaces \?\? \[\]\)\.filter\(/);
  assert.match(screens, /onPress=\{\(\) => void switchTo\(workspace\)\}/);
  assert.match(screens, /const next = await chooseWorkspace\(workspace\);\s*await refreshMe\(\);\s*router\.replace\(resolveEntryRoute\(next\) as never\);/);
  // Suspension is said on every tab, read from capabilities, never inferred.
  assert.match(screens, /if \(!me \|\| me\.capabilities\.artisan\.can_quote\) return null;/);
  assert.equal((screens.match(/<SuspendedNotice me=\{me\} \/>/g) ?? []).length, 4);
});

test("the application never switches anybody, and only an open experience offers the way in", () => {
  const screen = code(read("app/(app)/artisan-application.tsx"));

  // The one chooseWorkspace call is behind the approved button.
  assert.equal((screen.match(/chooseWorkspace\(/g) ?? []).length, 1);
  assert.match(screen, /const open = status === "approved" \|\| status === "suspended";/);
  assert.match(screen, /\{open && !inside \? \(\s*<AuthAction label="Switch to artisan work"/);
  assert.match(screen, /<ArtisanApplicationForm\s/);

  const form = code(read("src/components/artisan/ArtisanApplicationForm.tsx"));
  // An ID is asked for only when applying and Danpa HQ holds none; certificates are optional.
  assert.match(form, /const needsId = mode === "apply" && !application\.identity_on_file;/);
  assert.match(form, /title="Certificates \(optional\)"/);
  // Editing saves the profile; it never re-applies.
  assert.match(form, /mode === "edit"\s*\? await updateArtisanProfile\(fields\)\s*: await applyAsArtisan\(\{ \.\.\.fields, identity_documents: identity \}\)/);
  // Payment wording: a connector, not a guarantor.
  assert.match(form, /Customers pay you directly; Danpa HQ does not hold or move the money\./);
  for (const source of [screen, form]) assert.doesNotMatch(source, /Trusted|Guaranteed|Payment protected/);
});

test("Find Artisans and every profile are pushed pages, never a sheet (owner, 2026-10-20)", () => {
  const stack = code(read("app/(app)/_layout.tsx"));
  assert.match(stack, /<Stack\.Screen name="artisans" options=\{\{ title: "Find Artisans" \}\} \/>/);
  assert.match(stack, /<Stack\.Screen name="artisan-view" options=\{\{ title: "Artisan" \}\} \/>/);
  assert.doesNotMatch(stack, /name="artisans"[^>]*presentation/);
  // A profile is its own page, not a view swapped in place.
  const find = code(read("app/(app)/artisans.tsx"));
  assert.match(find, /pathname: "\/\(app\)\/artisan-view"/);
  assert.doesNotMatch(find, /function Profile\(|setOpen\(/);
  assert.match(code(read("app/(app)/(provider-tabs)/more.tsx")), /\{ key: "artisans", icon: "hammer-outline", label: "Find Artisans", onPress: go\("\/\(app\)\/artisans"\) \}/);
  // Becoming one is a quiet header link inside it, gone once approved.
  const sheet = code(read("app/(app)/artisans.tsx"));
  assert.match(sheet, /const becomeLabel = !artisan \|\| artisan\.workspace_access\s*\? null/);
  assert.match(sheet, /onPress=\{\(\) => router\.push\("\/\(app\)\/artisan-application" as never\)\}/);
  // Inside it, three tabs — never new tabs in the bar.
  const screen = code(read("app/(app)/artisans.tsx"));
  assert.match(screen, /\{ key: "find", label: "Find" \},\s*\{ key: "requests", label: "Requests" \},\s*\{ key: "records", label: "Records" \},/);
});

test("electrical work shows only certified electricians until the person asks for the rest", () => {
  const screen = code(read("app/(app)/artisans.tsx"));
  assert.match(screen, /Wiring work needs a certified professional/);
  assert.match(screen, /discoverArtisans\(\{ trade, district, certified, showUncertified \}\)/);
  assert.match(screen, /onPress=\{\(\) => setShowUncertified\(true\)\}/);
  assert.match(screen, /if \(seenTrade !== trade\) \{\s*setSeenTrade\(trade\);\s*setShowUncertified\(false\);/);
  assert.doesNotMatch(screen, /Trusted|Guaranteed|Payment protected/);
});

test("on a repair, only the payer approves, it asks once more, and the tenant never sees the price", () => {
  const section = code(read("src/components/artisan/MaintenanceArtisans.tsx"));
  assert.match(section, /<Pill label="Approve" onPress=\{onAsk\} \/>/);
  assert.match(section, /<Pill label=\{`Approve \$\{quote\.price_display\}`\} busy=\{busy\} busyLabel="Approving…" onPress=\{\(\) => onDecide\(true\)\} \/>/);
  assert.match(section, /\{PAYMENT_TIP\}/);
  assert.match(section, /work\.permissions\.approve/);
  // Quotes are drawn only for the provider side; the tenant's block has none.
  assert.match(section, /\{quote && side === "provider" \? \(/);
});

test("an artisan's job page opens the address only once the backend unlocks it", () => {
  const job = code(read("app/(app)/artisan-job.tsx"));
  assert.match(job, /const job = row\.unlocked \? row\.job : undefined;/);
  assert.match(job, /The address and a contact open here if your quote is approved\./);
  assert.match(job, /Linking\.openURL\(`tel:\$\{job\.contact\.phone/);
});

test("Post a job and each posted job are pushed pages, reached only from Find Artisans", () => {
  const layout = code(read("app/(app)/_layout.tsx"));
  assert.match(layout, /<Stack\.Screen name="direct-job" options=\{\{ title: "Your job" \}\} \/>/);
  assert.match(layout, /<Stack\.Screen name="direct-job-new" options=\{\{ title: "Post a job" \}\} \/>/);
  const find = code(read("app/(app)/artisans.tsx"));
  assert.match(find, /label="Post a job" onPress=\{\(\) => router\.push\("\/\(app\)\/direct-job-new" as never\)\}/);
  // Posting gives way to the job: Back returns to Find Artisans, not a sent form.
  assert.match(code(read("app/(app)/direct-job-new.tsx")), /router\.replace\(\{ pathname: "\/\(app\)\/direct-job", params: \{ id: posted\.job\.id \} \}/);
  for (const path of ["app/(app)/(tabs)/profile.tsx", "app/(app)/(provider-tabs)/more.tsx"]) {
    assert.doesNotMatch(code(read(path)), /Post a job/, `${path} offers Post a job`);
  }
});

test("a posted job is decided with the repair's quote card, and asking goes to the job's endpoint", () => {
  const page = code(read("app/(app)/direct-job.tsx"));
  assert.match(page, /<WorkArtisans work=\{job\} side="provider" onChanged=\{load\} onFind=\{find\} directJobId=\{about\.id\} \/>/);
  assert.match(page, /params: \{ request: about\.id, kind: "direct_job", mode: "invite"/);
  assert.match(page, /job\.permissions\.cancel \?/);
  const profile = code(read("app/(app)/artisan-view.tsx"));
  assert.match(profile, /if \(forRequest\.kind === "direct_job"\) await inviteToDirectJob\(forRequest\.id, artisanId\);/);
  assert.match(code(read("app/(app)/artisan-job.tsx")), /submitRevision\(row\.request\.kind, row\.request\.id, input\)/);
  assert.match(code(read("src/notificationMeaning.ts")), /case "artisan_direct_job":\s*return \{ pathname: "\/\(app\)\/direct-job", params: \{ id: item\.target_id \} \};/);
});

test("Report a problem offers exactly the backend's categories, in its order and words", () => {
  const backend = read("../backend/apps/artisan/reports.py");
  const lib = code(read("src/artisan.ts"));
  for (const name of ["ABOUT_ARTISAN", "ABOUT_CUSTOMER"]) {
    const start = backend.indexOf(`${name} = {`);
    const block = backend.slice(start, backend.indexOf("}", start));
    const server = [...block.matchAll(/"([a-z_]+)": "([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);
    const listStart = lib.indexOf(`export const ${name}`);
    const list = lib.slice(listStart, lib.indexOf("];", listStart));
    const client = [...list.matchAll(/value: "([a-z_]+)", label: "([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);
    assert.ok(server.length >= 4, `no ${name} parsed`);
    assert.deepEqual(client, server, name);
  }
});

test("the finish shows on repairs, posted jobs and the artisan's job; payment says nothing moves", () => {
  const finish = code(read("src/components/artisan/WorkFinish.tsx"));
  assert.match(finish, /<Type variant="caption" style=\{\{ color: theme\.color\.ink\["700"\] \}\}>\{PAID_NOTE\}<\/Type>/);
  assert.match(finish, /label="Record payment" onPress=\{\(\) => setAsking\(true\)\}/);
  assert.doesNotMatch(finish, /rating|stars?\b|score/i);
  const shared = code(read("src/components/artisan/MaintenanceArtisans.tsx"));
  assert.match(shared, /<WorkFinish[\s\S]*?canConfirm=\{Boolean\(work\.permissions\.confirm\)\}/);
  assert.match(code(read("app/(app)/direct-job.tsx")), /directJobId=\{about\.id\}/);
  const own = code(read("app/(app)/artisan-job.tsx"));
  assert.match(own, /row\.permissions\?\.report_done && !pending \? \(\s*<WorkDoneForm/);
  assert.match(own, /<ProblemReport target=\{\{ kind: "job", invitationId: row\.id \}\} side="artisan" \/>/);
  assert.match(code(read("app/(app)/artisan-view.tsx")), /artisan\.is_you \? null : <ProblemReport target=\{\{ kind: "artisan", artisanId: artisan\.id \}\} \/>/);
});
