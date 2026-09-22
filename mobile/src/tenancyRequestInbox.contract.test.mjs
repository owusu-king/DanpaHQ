/**
 * Tenancy requests, refined on review (2026-09-15).
 *
 * People asking to rent, from a listing or with a Unit's access code, read as one
 * inbox. How many wait for a decision leads, with how long the oldest has waited;
 * then one list grouped by what each request needs. One green Filter holds the
 * stage and the source together, beside a search. These tests hold what the inbox
 * says about a request, not only where it sits.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};
const screen = () => code(read("app/(app)/provider-applications.tsx"));

test("what waits on the provider leads, and how long the oldest has waited", () => {
  const source = screen();
  assert.match(source, /const waiting = items\.filter\(\(item\) => itemStage\(item\) === "action"\);/);
  // Every request, whatever the Filter is showing.
  assert.match(source, /const toPrepare = items\.filter\(\(item\) => itemStage\(item\) === "agreement"\)\.length;/);
  assert.match(source, /const oldest = waiting\.map\(createdAt\)\.sort\(\)\[0\];/);
  assert.match(source, /const days = oldest \? Math\.floor\(\(Date\.now\(\) - new Date\(oldest\)\.getTime\(\)\) \/ 86_400_000\) : 0;/);
  assert.match(
    source,
    /\? \{ text: days > 0 \? `Oldest waiting \$\{days\} \$\{days === 1 \? "day" : "days"\}` : "All arrived today", tone: days >= 3 \? "alert" : "calm" \}\s*: \{ text: "Nothing waiting on you", tone: "calm" \};/,
  );
  assert.match(source, /<SummaryPanel\s+label="Waiting for your decision"\s+value=\{String\(waiting\.length\)\}\s+note=\{note\}/);
  assert.match(source, /\{ label: "Need an agreement", value: String\(toPrepare\) \},\s*\{ label: "All requests", value: String\(items\.length\) \},/);
  assert.doesNotMatch(source, /Review people asking to rent|variant="display2"/);
});

test("one inbox from two sources, grouped by what each request needs", () => {
  const source = screen();
  assert.match(source, /summaries[\s\S]*flatMap\(\(summary\) => summary\.tenancy_requests\.map\(\(request\) => \(\{ key: `private:\$\{request\.id\}`, kind: "private" as const, request, organizationId: summary\.organization\.id \}\)\)\)/);
  assert.match(source, /kind: "application" as const, application, lease: leaseByApplication\.get\(application\.id\) \?\? null/);
  assert.match(source, /\]\.sort\(\(a, b\) => createdAt\(b\)\.localeCompare\(createdAt\(a\)\)\);/);

  const entries = between(source, "function entriesFor(", "function RequestRow(");
  assert.match(entries, /for \(const stage of show === "all" \? \(\["action", "agreement", "history"\] as const\) : \[show\]\)/);
  assert.match(entries, /title: GROUP_TITLE\[stage\], count: group\.length, tone: stage === "action" \? LATERITE : undefined/);
  assert.match(source, /action: "Needs your decision",\s*agreement: "Agreement to prepare",\s*history: "History",/);
  assert.match(source, /const HISTORY_SHOWN = 3;/);
  assert.match(entries, /const cut = stage === "history" && show === "all" && group\.length > HISTORY_SHOWN;/);
  assert.match(entries, /if \(cut\) out\.push\(\{ kind: "more", key: "more:history", count: group\.length \}\);/);
  assert.match(source, /<ViewAll count=\{entry\.count\} noun="in history" onPress=\{\(\) => choose\("history"\)\} \/>/);
  assert.match(source, /<FlatList\s+ref=\{list\}\s+data=\{entries\}/);
  assert.doesNotMatch(source, /accessibilityRole="tab"|accessibilityRole="tablist"|function RequestTab\(/);

  // Where each request has got to: unchanged rules for both records.
  const stage = between(source, "function itemStage(", "function toneOf(");
  assert.match(stage, /\["submitted", "under_review"\]\.includes\(item\.application\.status\)\) return "action"/);
  assert.match(stage, /item\.application\.status === "accepted" && \(!item\.lease \|\| item\.lease\.status === "draft"\)\) return "agreement"/);
  assert.match(stage, /if \(item\.request\.status === "pending"\) return "action";/);
  assert.match(stage, /item\.request\.status === "approved" && \(!item\.request\.lease_id \|\| item\.request\.lease_status === "draft"\)\) return "agreement";/);
});

test("one Filter holds the stage and the source together", () => {
  const source = screen();
  assert.match(source, /<ListHead title=\{TITLE\[stage\]\} count=\{visible\.length\} filters=\{\(stage === "all" \? 0 : 1\) \+ \(source === "all" \? 0 : 1\)\} filterTone="kola" onFilter=\{\(\) => setFiltering\(true\)\} \/>/);
  assert.match(source, /<SearchField label="Search requests" placeholder="Person, Property or Unit" value=\{query\} onChangeText=\{setQuery\} \/>/);
  assert.match(source, /\.filter\(\(item\) => inStage\(item, stage\) && fromSource\(item, source\)\)/);

  // Each choice counts what it would show beside the other choice already made.
  assert.match(source, /const stageCount = \(value: Show\) => items\.filter\(\(item\) => fromSource\(item, source\) && inStage\(item, value\)\)\.length;/);
  assert.match(source, /const sourceCount = \(value: Source\) => items\.filter\(\(item\) => inStage\(item, stage\) && fromSource\(item, value\)\)\.length;/);
  for (const [label, value] of [["All requests", "all"], ["Needs action", "action"], ["Agreement", "agreement"], ["History", "history"]]) {
    assert.match(source, new RegExp(`label="${label}" count=\\{stageCount\\("${value}"\\)\\} selected=\\{stage === "${value}"\\} onPress=\\{\\(\\) => choose\\("${value}"\\)\\}`), label);
  }
  assert.match(source, /label="Everywhere" count=\{sourceCount\("all"\)\} selected=\{source === "all"\} onPress=\{\(\) => setSource\("all"\)\}/);
  assert.match(source, /label=\{SOURCE_LABEL\.application\} count=\{sourceCount\("application"\)\} selected=\{source === "application"\} onPress=\{\(\) => setSource\("application"\)\}/);
  assert.match(source, /label=\{SOURCE_LABEL\.private\} count=\{sourceCount\("private"\)\} selected=\{source === "private"\} onPress=\{\(\) => setSource\("private"\)\}/);
  assert.match(source, /application: "Public listing",\s*private: "Direct request",/);

  assert.match(source, /canReset=\{stage !== "all" \|\| source !== "all" \|\| Boolean\(query\)\}/);
  assert.match(source, /onReset=\{\(\) => \{ choose\("all"\); setSource\("all"\); setQuery\(""\); \}\}/);
  assert.match(source, /results=\{visible\.length\}/);
});

test("a row says who, when, where, how it stands and where it came from", () => {
  const source = screen();
  const row = between(source, "function RequestRow(", "function InboxEmpty(");

  assert.match(row, /accessibilityLabel=\{`\$\{who\}, \$\{status\}, \$\{where\}\. \$\{SOURCE_LABEL\[item\.kind\]\}, received \$\{received\}\.`\}/);
  assert.match(row, /const received = timeAgo\(createdAt\(item\)\);/);
  assert.match(row, /end=\{<Type variant="caption" numberOfLines=\{1\} style=\{rowStyles\.rowMeta\}>\{received\}<\/Type>\}/);
  // The exact space, down to the bed, for a direct request.
  assert.match(row, /\[item\.request\.property_title, item\.request\.unit_label, item\.request\.bed_label\]\.filter\(Boolean\)\.join\(" · "\)/);
  assert.match(row, /<Type variant="caption" style=\{\[rowStyles\.rowStatus, \{ color: tone\.text \}\]\}>\{status\}<\/Type>\s*\{` · \$\{SOURCE_LABEL\[item\.kind\]\}`\}/);
  assert.match(row, /<View style=\{\[styles\.initials, \{ backgroundColor: tone\.wash \}\]\}>/);

  // Settled the provider's way in kola; a refusal, a withdrawal or an ending quietly.
  const tone = between(source, "function toneOf(", "function statusLabel(");
  assert.match(tone, /if \(stage === "action"\) return "attention";\s*if \(stage === "agreement"\) return "waiting";/);
  assert.match(tone, /\["rejected", "withdrawn", "cancelled", "declined", "ended"\]\.includes\(settled\) \? "neutral" : "good"/);
  assert.match(source, /attention: \{ text: LATERITE, ink: LATERITE, wash: theme\.color\.laterite\["100"\] \},/);

  assert.match(source, /pathname: "\/\(app\)\/provider-application", params: \{ kind: item\.kind, id: item\.kind === "application" \? item\.application\.id : item\.request\.id, organizationId: item\.kind === "private" \? item\.organizationId : "" \}/);
});

test("the Portfolio on screen, loading, nothing yet and a failure are each handled", () => {
  const source = screen();
  assert.match(source, /useBlankOnPortfolioSwitch\(activeContext, \(\) => \{\s*setSummaries\(null\);\s*setApplications\(null\);\s*setLeases\(\[\]\);\s*\}\);/);
  assert.match(source, /listReceivedApplications\(false, scope\),\s*listGrantedLeases\(scope\),/);
  assert.match(source, /\}, \[activeContext\]\);/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /ListEmptyComponent=\{applications === null \? <InboxSkeleton \/> : error \? null : \(/);
  assert.match(between(source, "function InboxSkeleton(", "function itemStage("), /accessibilityRole="progressbar" accessibilityLabel="Loading tenancy requests"/);

  const empty = between(source, "function InboxEmpty(", "function InboxSkeleton(");
  assert.match(empty, /if \(narrowed\) return <EmptyState icon="search-outline" title="No matching requests"/);
  assert.match(empty, /hero\s+title="No tenancy requests yet"/);
  assert.match(empty, /label="Tenants" onPress=\{onTenants\}/);
  assert.match(source, /narrowed=\{Boolean\(query\.trim\(\)\) \|\| source !== "all"\}/);
  assert.match(source, /onTenants=\{\(\) => router\.push\("\/\(app\)\/\(provider-tabs\)\/tenants" as never\)\}/);
});
