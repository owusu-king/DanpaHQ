import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The artisan network on web.
 *
 * The trade filter is a copy of the backend's list, so a trade added there and
 * forgotten here would be impossible to find. And the product's position — a
 * connector and record-keeper, never a guarantor — is a rule about words, so it
 * is checked as one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("the trade filter offers exactly the backend's trades, in its order and words", () => {
  const models = read("backend/apps/artisan/models.py");
  const block = models.slice(models.indexOf("class Trade("), models.indexOf("\n\n\n", models.indexOf("class Trade(")));
  const backend = [...block.matchAll(/= "([a-z_]+)", "([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);
  const client = code(read("web/src/lib/artisan.ts"));
  const list = client.slice(client.indexOf("export const TRADES"), client.indexOf("];", client.indexOf("export const TRADES")));
  const web = [...list.matchAll(/value: "([a-z_]+)", label: "([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);

  assert.ok(backend.length >= 10, "no trades parsed from the backend");
  assert.deepEqual(web, backend);
});

test("no artisan screen promises what Danpa HQ does not do", () => {
  const files = [];
  for (const dir of ["web/src/components/artisan", "web/app/artisan"]) {
    (function walk(path) {
      for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
        const next = join(path, entry.name);
        if (entry.isDirectory()) walk(next);
        else if (entry.name.endsWith(".tsx")) files.push(next);
      }
    })(dir);
  }
  assert.ok(files.length >= 4);
  for (const file of files) {
    assert.doesNotMatch(code(read(file)), /\bTrusted\b|\bGuaranteed\b|Payment protected|trust score/i, file);
  }
});

test("the Artisans sheet keeps the electrical rule visible and its opt-in explicit", () => {
  const sheet = code(read("web/src/components/artisan/ArtisansSheet.tsx"));

  assert.match(sheet, /Wiring work needs a certified professional/);
  assert.match(sheet, /discoverArtisans\(\{ trade, district, certified, showUncertified \}/);
  assert.match(sheet, /onClick=\{\(\) => setShowUncertified\(true\)\}/);
  // A different trade forgets the opt-in rather than carrying it over.
  assert.match(sheet, /if \(seenTrade !== trade\) \{\s*setSeenTrade\(trade\);\s*setShowUncertified\(false\);/);
  // Certified is the shared switch, never a native box.
  assert.match(sheet, /<Switch checked=\{certified\} onChange=\{setCertified\} label="Certified only" \/>/);
});

test("becoming an artisan is a quiet link in the Artisans sheet, never a menu item", () => {
  // Owner, 2026-10-20: not pushed on tenants or providers. The account menu
  // gains only the switch, and only once the backend opens the experience.
  const menu = code(read("web/src/components/portal/AccountMenu.tsx"));
  assert.doesNotMatch(menu, /Become an artisan|Your artisan application|href=\{"\/artisan"/);
  assert.match(menu, /artisan: "Switch to artisan experience"/);

  const sheet = code(read("web/src/components/artisan/ArtisansSheet.tsx"));
  assert.match(sheet, /const becomeLabel = !artisan \|\| artisan\.workspace_access\s*\? null/);
  assert.match(sheet, /headerAction=\{becomeLabel && !top \? \(\s*<Link href=\{"\/artisan" as never\} onClick=\{onClose\}>\{becomeLabel\}<\/Link>/);
});

test("approving a price asks once more, and always says how to pay safely", () => {
  const section = code(read("web/src/components/artisan/MaintenanceArtisans.tsx"));
  // The first press asks; only the confirming press approves.
  assert.match(section, /onClick=\{onAsk\}>Approve<\/button>/);
  assert.match(section, /onClick=\{\(\) => onDecide\(true\)\}>\s*\{busy \? "Approving…" : `Approve \$\{quote\.price_display\}`\}/);
  assert.match(section, /<p className="mt-quote-tip">\{PAYMENT_TIP\}<\/p>/);
  assert.match(code(read("web/src/lib/artisan.ts")), /PAYMENT_TIP = "Pay after the work is confirmed done, or a small deposit at most\."/);
  // What a reader may do comes from the backend, never worked out here.
  assert.match(section, /work\.permissions\.approve/);
  assert.match(section, /work\.permissions\.invite/);
});

test("an artisan sees the address only once the backend unlocks it", () => {
  const work = code(read("web/src/components/artisan/ArtisanWork.tsx"));
  assert.match(work, /const job = row\.unlocked \? row\.job : undefined;/);
  assert.match(work, /The address and a contact open here if your quote is approved\./);
});

test("a posted job is decided with the same quote card, so it asks once and shows the tip", () => {
  const jobs = code(read("web/src/components/artisan/DirectJobs.tsx"));
  // Not a second copy of the approval flow: the card that asks once more and shows PAYMENT_TIP.
  assert.match(jobs, /import \{ Brief, QuoteCard \} from "@\/components\/artisan\/MaintenanceArtisans";/);
  assert.match(jobs, /<QuoteCard[\s\S]*?canDecide=\{permissions\.approve/);
  assert.doesNotMatch(jobs, /PAYMENT_TIP/);
  // What the owner may do is the backend's call.
  assert.match(jobs, /permissions\.invite \?/);
  assert.match(jobs, /permissions\.cancel \?/);
});

test("Post a job lives in the Artisans sheet's Requests, never in a menu", () => {
  const sheet = code(read("web/src/components/artisan/ArtisansSheet.tsx"));
  assert.match(sheet, /<Plus aria-hidden="true" \/> Post a job/);
  assert.match(sheet, /onPost=\{\(\) => nav\.push\(\{ kind: "post" \}\)\}/);
  for (const path of ["web/src/components/portal/AccountMenu.tsx", "web/src/lib/portalNav.ts"]) {
    assert.doesNotMatch(code(read(path)), /Post a job/, `${path} offers Post a job`);
  }
});

test("asking for a posted job goes to the job's own endpoint, and a revision follows its kind", () => {
  const sheet = code(read("web/src/components/artisan/ArtisansSheet.tsx"));
  assert.match(sheet, /if \(forRequest\.kind === "direct_job"\) await inviteToDirectJob\(forRequest\.id, artisanId\);/);
  const lib = code(read("web/src/lib/artisan.ts"));
  assert.match(lib, /kind === "direct_job" \? `\/direct-jobs\/\$\{id\}\/revisions\/` : `\/maintenance\/\$\{id\}\/revisions\/`/);
  assert.match(code(read("web/src/components/artisan/ArtisanWork.tsx")), /submitRevision\(row\.request\.kind, row\.request\.id, input\)/);
});

test("a job notification opens the job in the Artisans sheet, over Updates", () => {
  const updates = code(read("web/app/updates/page.tsx"));
  assert.match(updates, /if \(item\.target_type === "artisan_direct_job"\) \{[\s\S]*?openArtisans\(\{ job: item\.target_id \}\);\s*return;/);
  assert.match(code(read("web/src/components/artisan/ArtisansSheet.tsx")), /useModalViews<View>\(open, request, request\.job \? \[\{ kind: "job", id: request\.job \}\] : undefined\)/);
  assert.match(read("backend/apps/notifications/handlers.py"), /"artisan_direct_job", job\.id/);
});

test("Report a problem offers exactly the backend's categories, in its order and words", () => {
  const backend = read("backend/apps/artisan/reports.py");
  const lib = code(read("web/src/lib/artisan.ts"));
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

test("recording payment says no money moves, and a review is words, never a score", () => {
  const finish = code(read("web/src/components/artisan/WorkFinish.tsx"));
  assert.match(code(read("web/src/lib/artisan.ts")), /PAID_NOTE = "This records that you paid\. Danpa HQ does not move or hold any money\."/);
  assert.match(finish, /<p className="mt-quote-tip">\{PAID_NOTE\}<\/p>/);
  // The first press asks; only the second records.
  assert.match(finish, /onClick=\{\(\) => setAsking\(true\)\}>Record payment<\/button>/);
  assert.doesNotMatch(finish, /rating|stars?\b|score/i);
  // Every next step is the backend's call.
  assert.match(finish, /work\.may_record_paid/);
  assert.match(finish, /work\.may_review/);
});

test("the finish shows on a repair, a posted job and the artisan's own job", () => {
  assert.match(code(read("web/src/components/artisan/MaintenanceArtisans.tsx")), /<WorkFinish\s/);
  const job = code(read("web/src/components/artisan/DirectJobs.tsx"));
  assert.match(job, /<WorkFinish[\s\S]*?canConfirm=\{Boolean\(permissions\.confirm\)\}/);
  const own = code(read("web/src/components/artisan/ArtisanWork.tsx"));
  assert.match(own, /row\.permissions\?\.report_done && !pending \? <WorkDoneForm/);
  assert.match(own, /<ProblemReport target=\{\{ kind: "job", invitationId: row\.id \}\} side="artisan" \/>/);
  assert.match(code(read("web/src/components/artisan/ArtisansSheet.tsx")), /artisan\.is_you \? null : <ProblemReport target=\{\{ kind: "artisan", artisanId: artisan\.id \}\} \/>/);
});
