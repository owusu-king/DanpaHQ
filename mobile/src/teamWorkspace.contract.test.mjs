import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile Team is a scalable roster with one focused member screen", () => {
  const team = read("mobile/app/(app)/team.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");

  assert.match(team, /FlatList/);
  assert.match(team, /Search members/);
  assert.match(team, /Invite someone/);
  assert.match(team, /presentationStyle="pageSheet"/);
  assert.match(team, /pathname: "\/\(app\)\/team-member"/);
  assert.match(layout, /name="team-member" options=\{\{ title: "Team member" \}\}/);

  // Pending invitations sit with the people they will become, not in a second
  // stack of cards below everything.
  assert.match(team, /kind: "invitation"/);
});

test("removing a member cannot happen on one stray tap", () => {
  const team = read("mobile/app/(app)/team.tsx");
  const member = read("mobile/app/(app)/team-member.tsx");

  // The old card carried an unconfirmed destructive button per member.
  assert.doesNotMatch(team, /removePortfolioMember/);
  assert.match(member, /removePortfolioMember/);
  assert.match(team, /Revoke this invitation\?/);

  // The confirmation was an OS alert and is now a sheet, so that it can name
  // the person, what they lose and what they keep in the product's own voice.
  // What is pinned is the step, not the widget: the act is never reachable
  // without a second, deliberate one.
  assert.match(member, /onPress=\{\(\) => setRemoving\(true\)\}/, "the page's word must only open the sheet");
  assert.match(member, /title=\{`Remove \$\{member\.display_name\}\?`\}/);
  assert.match(member, /tone="danger"/);
  assert.match(member, /closeLabel="Keep their access"/);
  // And the act itself lives inside that sheet, never on the page behind it.
  assert.ok(
    member.indexOf("<BottomSheet") < member.indexOf("void remove()"),
    "removing runs from the page rather than from the confirmation",
  );
});

test("access changes are staged, then settled once", () => {
  const member = read("mobile/app/(app)/team-member.tsx");

  assert.match(member, /const dirty = roleChanged \|\| scopeChanged/);
  assert.match(member, /Save access/);
  assert.match(member, /Discard changes/);
  assert.match(member, /scope\.filter\(\(id\) => !assigned\.includes\(id\)\)/);
  assert.match(member, /assigned\.filter\(\(id\) => !scope\.includes\(id\)\)/);
});

test("both Team screens describe a role the same way", () => {
  const patterns = read("mobile/src/components/team/TeamPatterns.tsx");
  const team = read("mobile/app/(app)/team.tsx");
  const member = read("mobile/app/(app)/team-member.tsx");
  const ui = read("mobile/src/components/ui.tsx");

  assert.match(patterns, /export function roleConsequence/);
  assert.match(team, /from "@\/components\/team\/TeamPatterns"/);
  assert.match(member, /from "@\/components\/team\/TeamPatterns"/);

  // A tick in a label is invisible to a screen reader, so a toggle says so —
  // and says it where both renderers listen. See `ariaState.contract.test.mjs`.
  assert.match(ui, /accessibilityRole=\{selected === undefined \? "button" : "checkbox"\}/);
  assert.match(ui, /aria-checked=\{selected\}/);
  assert.match(patterns, /selected=\{selected\.includes\(property\.id\)\}/);
});
