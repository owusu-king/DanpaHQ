import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("Team is a roster, not a page of controls at rest", () => {
  const team = read("web/app/settings/team/page.tsx");

  // Inviting is a task behind an action, not a form left open above the people
  // you came to see. Each member's controls live behind opening that member.
  assert.match(team, /Invite someone/);
  assert.match(team, /function InviteDialog/);
  assert.match(team, /function MemberDialog/);
  assert.match(team, /setOpenMemberId\(member\.id\)/);

  // The old page rendered a role select and every Property as checkboxes inside
  // every row; nothing but the roster should be in the list now.
  assert.doesNotMatch(team, /<section style=\{SECTION\}>/);
  assert.doesNotMatch(team, /React\.CSSProperties/);
});

test("changing or ending someone's access is deliberate and reversible until confirmed", () => {
  const team = read("web/app/settings/team/page.tsx");

  // Role used to apply the instant the select changed, and removal used the
  // browser's own confirm() rather than the product's confirmation pattern.
  assert.doesNotMatch(team, /window\.confirm/);
  assert.match(team, /confirmingRemoval/);
  assert.match(team, /Confirm removal/);
  assert.match(team, /Confirm revoke/);
  assert.match(team, /Save access/);
  assert.match(team, /Unsaved changes to what this person can reach/);
  assert.match(team, />Discard</);

  // A role is described by what the person will be able to do.
  assert.match(team, /function roleConsequence/);
  assert.match(team, /can change anyone's access/);
});

test("Property scope is settled as a set, not one request per tick", () => {
  const team = read("web/app/settings/team/page.tsx");

  assert.match(team, /scope\.filter\(\(id\) => !assignedIds\.includes\(id\)\)/);
  assert.match(team, /assignedIds\.filter\(\(id\) => !scope\.includes\(id\)\)/);
  assert.match(team, /assignPortfolioProperty/);
  assert.match(team, /unassignPortfolioProperty/);
});

test("a scoped role is told why the roster is absent, not shown an empty one", () => {
  const team = read("web/app/settings/team/page.tsx");

  assert.match(team, /the roster is not shown to you/);

  // Listing members is owner/admin only, so Team is the only surface that reads
  // the roster at all — nothing else can turn that refusal into a count.
  assert.match(team, /listPortfolioMembers/);
});

test("the Team dialogs match the record pattern the other areas set", () => {
  const team = read("web/app/settings/team/page.tsx");
  const css = read("web/src/styles/team-workspace.css");

  // Two dialogs are mounted at once, so a shared aria-labelledby target would
  // name the wrong one.
  assert.match(team, /id="team-invite-dialog"/);
  assert.match(team, /id="team-member-dialog"/);
  assert.match(team, /aria-labelledby=\{`\$\{id\}-title`\}/);

  // Unsaved changes keep their controls in one place rather than appearing
  // between sections and scrolling out of reach.
  assert.match(css, /\.team-dialog-footer[\s\S]*position: sticky/);
  assert.match(team, /footer=\{/);

  // The member reads as a record — labelled facts — like the Lease record does.
  assert.match(css, /\.team-facts dt/);
  assert.match(team, /<dt>Reaches now<\/dt>/);

  // Every other workspace states its focus ring; the UA default vanishes here.
  assert.match(css, /focus-visible[\s\S]*outline: 3px solid var\(--color-lagoon-600\)/);

  // Phone width turns the dialog into a bottom sheet.
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*margin: auto 0 0/);
});

