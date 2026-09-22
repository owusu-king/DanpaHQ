/**
 * Team, as a roster.
 *
 * How many people hold access leads; the Portfolio's own identity follows as
 * facts; then members and the people invited to become members read as one
 * list, because an invitation is a person who is nearly here. Anything with a
 * keyboard — naming the Portfolio, inviting somebody — opens as its own page
 * sheet rather than unfolding the page underneath.
 *
 * `teamWorkspace` and `portfolioTeam` pin the lifecycle this screen serves.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const screen = () => read("app/(app)/team.tsx");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("how many people hold access leads, with what is waiting said once", () => {
  const source = screen();
  assert.match(source, /label="People with access"/);
  assert.match(source, /\{ label: "Invited", value: String\(pending\.length\) \}/);
  assert.match(source, /\{ label: "Properties", value: String\(properties\.length\) \}/);

  // The note answers the one question the summary raises, in priority order:
  // what is blocked, then what is waiting, then that nothing is.
  assert.match(source, /canManage && !canGrant[\s\S]{0,120}tone: "alert"/);
  assert.match(source, /pending\.length === 1 \? "invitation" : "invitations"\} waiting to be accepted/);

  // The stack header says "Team"; the page does not say it again.
  assert.doesNotMatch(code(source), />\s*Team\s*<\/Type>/);
});

test("members and invitations are one list, named only when both are there", () => {
  const source = screen();
  assert.match(source, /\{ key: "members", title: "Members", items: rows\.filter\(\(row\) => row\.kind === "member"\) \}/);
  assert.match(source, /\{ key: "invited", title: "Invited", items: rows\.filter\(\(row\) => row\.kind === "invitation"\) \}/);
  assert.match(source, /const grouped = !query\.trim\(\) && members\.length > 0 && pending\.length > 0;/);

  // Narrowing is bound to a const so it survives into the press handlers.
  assert.match(source, /const row = entry\.row;/);
});

test("a row carries the person, their reach and their role, and opens their own screen", () => {
  const source = screen();
  assert.match(source, /initialsOf\(member\.display_name\)/);
  assert.match(source, /roleLabel\(member\.role\)/);
  assert.match(source, /accessLabel\(member\)/);
  assert.match(source, /accessStateLabel\(member\)/);
  assert.match(source, /pathname: "\/\(app\)\/team-member"/);

  // Portfolio-wide reach in kola, something unfinished in harmattan, an ended
  // one in laterite — never the same disc for every state.
  assert.match(source, /if \(state === "revoked"\) return \{ ink: LATERITE/);
  assert.match(source, /state === "pending_verification" \|\| state === "limited"/);
  assert.match(source, /member\.effective_access === "portfolio_wide"/);
});

test("revoking an invitation is deliberate, and happens where the invitation is", () => {
  const source = screen();
  // The row opens the invitation; the confirmation is inside it, not a second
  // destructive button sitting in the list.
  assert.match(source, /title="Invitation"/);
  assert.match(source, /title="Revoke this invitation\?"/);
  assert.match(source, /label="Confirm revoke"/);
  assert.match(source, /label="Keep it"/);
  assert.match(source, /await revokePortfolioInvitation\(organizationId, invitation\.id\);/);
});

test("anything with a keyboard opens as its own page sheet", () => {
  const source = screen();
  // Naming the Portfolio and inviting somebody are both forms. A form unfolded
  // in the middle of a roster moves the list somebody was reading.
  assert.equal((source.match(/presentationStyle="pageSheet"/g) ?? []).length, 2);
  assert.match(source, /label="Portfolio name"/);
  assert.match(source, /label="Edit Portfolio details"/);
  assert.match(source, /updateOrganization\(organization\.id, \{/);
});

test("the search appears when a roster is long enough to need it", () => {
  const source = screen();
  assert.match(source, /const SEARCHABLE_FROM = 7;/);
  assert.match(source, /const searchable = canManage && members\.length >= SEARCHABLE_FROM;/);
  assert.match(source, /label="Search members"/);
  assert.match(source, /accessibilityLabel="Loading your Team"/);
});
