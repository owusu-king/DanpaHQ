/**
 * Provider Payments, refined on review (2026-09-15).
 *
 * One reading order — the figures, what needs a decision, then the list — and one
 * Filter control in place of a row of view tabs and a row of status chips. These
 * tests hold the parts that make it a financial product rather than a pretty
 * one: payment and settlement stay different facts, the filter state is always
 * said on the page, an amount or a status is never cut short, and nothing the
 * page could do before is lost.
 *
 * The glass, the Filter control, its sheet and the row lines are `PortfolioList`'s,
 * shared with Tenants, so where a promise is kept by a shared part the test reads
 * the kit, and where it is kept by how Payments uses it the test reads the page.
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
const screen = () => code(read("app/(app)/(provider-tabs)/payments.tsx"));
const kit = () => code(read("src/components/portfolio/PortfolioList.tsx"));

test("one Filter control replaces the tabs and the chips", () => {
  const source = screen();
  const parts = kit();

  // No row of view tabs and no row of status chips spread across the page.
  assert.doesNotMatch(source + parts, /accessibilityRole="tab"|accessibilityRole="tablist"|accessibilityRole="toolbar"|function ViewTab|function FilterChip/);

  // One button opens every filter and says how many are on.
  assert.match(source, /<ListHead title=\{VIEW_LABEL\[view\]\} count=\{rows\.length\} filters=\{activeFilters\} onFilter=\{\(\) => setFiltering\(true\)\} \/>/);
  assert.match(parts, /<FilterButton count=\{filters\} tone=\{filterTone\} onPress=\{onFilter\} \/>/);
  assert.match(parts, /accessibilityLabel=\{active \? `Filter, \$\{count\} active` : "Filter"\}/);
  assert.match(source, /const activeFilters = view === "balances" && filter !== "all" \? 1 : 0;/);

  // The sheet is the shared one a thumb can put away, not a modal of its own.
  assert.match(source, /import \{ BottomSheet \} from "@\/components\/sheet\/BottomSheet";/);
  assert.match(source, /<BottomSheet\s+visible=\{visible\}\s+onClose=\{onClose\}\s+title="Filter"\s+closeLabel="Close filter"/);
  assert.doesNotMatch(between(source, "function FilterSheet(", "function ExpenseModal("), /<Modal/);
});

test("the sheet groups what to show and which balances, with counts, and closes on its results", () => {
  const source = screen();
  const parts = kit();
  const sheet = between(source, "function FilterSheet(", "function ExpenseModal(");

  assert.match(sheet, /<FilterGroup title="Show">\s*\{VIEWS\.map\(/);
  // Rent statuses only for the list they can filter.
  assert.match(sheet, /\{view === "balances" \? \(\s*<FilterGroup title="Rent status">\s*\{STATUSES\.map\(/);
  assert.match(sheet, /count=\{viewCount\(value\)\}/);
  assert.match(sheet, /count=\{statusCount\(value\)\}/);
  assert.match(sheet, /onPress=\{\(\) => onView\(value\)\}/);
  assert.match(sheet, /onPress=\{\(\) => onFilter\(value\)\}/);

  // Answers are radios in a named group.
  assert.match(parts, /accessibilityRole="radiogroup" accessibilityLabel=\{title\}/);
  assert.match(parts, /accessibilityRole="radio"\s+aria-selected=\{selected\}/);

  // It closes on what it will show, and Reset returns to where the page opens.
  assert.match(sheet, /footer=\{<SheetFooter canReset=\{changed\} onReset=\{onReset\} results=\{results\} onShow=\{onClose\} \/>\}/);
  assert.match(parts, /Show \{results\} \{results === 1 \? "result" : "results"\}/);
  assert.match(source, /results=\{rows\.length\}/);
  assert.match(source, /onReset=\{\(\) => \{ setView\("balances"\); setFilter\("all"\); setQuery\(""\); \}\}/);

  // Changing what is shown clears the search, as the tabs did.
  assert.match(source, /function showView\(value: PaymentsView\) \{\s*setView\(value\);\s*setQuery\(""\);\s*\}/);
  assert.match(source, /onView=\{showView\}/);
});

test("what is on is said on the page: the list's name, its count, and one token to take it off", () => {
  const source = screen();
  const parts = kit();

  assert.match(parts, /<Type variant="title2" accessibilityRole="header" numberOfLines=\{1\} style=\{styles\.listTitleText\}>\{title\}<\/Type>/);
  assert.match(parts, /<Type variant="caption" style=\{styles\.listCount\}>\{count\}<\/Type>/);
  assert.match(source, /<ListHead title=\{VIEW_LABEL\[view\]\} count=\{rows\.length\}/);
  assert.match(
    source,
    /\{view === "balances" && filter !== "all" \? \(\s*<ActiveFilter label=\{STATUS_LABEL\[filter\]\} tone=\{STATUS_TONE\[filter\]\} onClear=\{\(\) => setFilter\("all"\)\} \/>/,
  );
  assert.match(parts, /accessibilityLabel=\{`Clear filter: \$\{label\}`\}/);
});

test("the figures lead, and payment and settlement stay different facts", () => {
  const source = screen();
  const parts = kit();

  // What is still owed leads; overdue is part of it; what was recorded and what
  // reached you sit apart, and nothing awaiting settlement is counted as settled.
  assert.match(
    source,
    /<SummaryPanel\s+label="Outstanding"\s+value=\{formatMinor\(summary\.money\.outstanding_minor\)\}\s+note=\{summary\.money\.overdue_minor > 0\s+\? \{ text: `\$\{formatMinor\(summary\.money\.overdue_minor\)\} overdue`, tone: "alert" \}\s+: \{ text: "Nothing overdue", tone: "calm" \}\}\s+facts=\{\[\s+\{ label: "Rent recorded", value: formatMinor\(summary\.money\.confirmed_received_minor\) \},\s+\{ label: "Settled to you", value: formatMinor\(summary\.money\.settled_net_minor\) \},\s+\]\}/,
  );
  assert.doesNotMatch(between(source, "<SummaryPanel", "/>"), /awaiting_settlement_minor/);
  assert.match(between(parts, "export function SummaryPanel(", "export function Figure("), /color: alert \? LATERITE : MUTED/);

  // Payouts name all four facts, and a payout row shows both checkpoints.
  const payouts = between(source, "<FigureGrid figures={[", "]} />");
  for (const label of ["Paid online", "Awaiting settlement", "Settled to you", "Fees deducted"]) {
    assert.match(payouts, new RegExp(`\\{ label: "${label}", value: formatMinor\\(`), label);
  }
  const settlement = between(source, "function SettlementRow(", "function ExpenseRow(");
  assert.match(settlement, />Paid<\/Type>/);
  assert.match(settlement, />Settled<\/Type>/);
  assert.match(settlement, /const amount = settled \? settlement\.net_minor! : settlement\.gross_minor;/);
});

test("anything that needs a decision goes straight to it", () => {
  const source = screen();

  assert.match(source, /if \(summary\.money\.overdue_minor > 0\) \{[\s\S]*?onPress: \(\) => \{ setView\("balances"\); setFilter\("overdue"\); \}/);
  assert.match(source, /if \(summary\.money\.payment_records_awaiting_you > 0\) \{[\s\S]*?onPress: \(\) => \{ setView\("records"\); setQuery\(""\); \}/);
  assert.match(source, /if \(summary\.money\.awaiting_settlement_minor > 0\) \{[\s\S]*?onPress: \(\) => \{ setView\("payouts"\); setQuery\(""\); \}/);
  assert.match(source, /if \(summary\.money\.settlement_attention_minor > 0\) \{[\s\S]*?onPress: \(\) => \{ setView\("payouts"\); setQuery\(""\); \}/);
  assert.match(source, /payoutDestination\.active_profile\?\.status !== "verified"/);
  assert.match(source, /<SignalPanel title="Needs attention" signals=\{signals\} \/>/);
  assert.match(between(kit(), "export function SignalPanel(", "export function InfoNote("), /if \(!signals\.length\) return null;/);
});

test("a row never cuts an amount or a status short", () => {
  const source = screen();
  const parts = kit();

  // Each line gives its words the width that is left; the end never gives way.
  assert.match(between(parts, "export function RowLine(", "export function EmptyState("), /<View style=\{styles\.lineStart\}>\{start\}<\/View>/);
  assert.match(parts, /lineStart: \{\s*flex: 1,\s*minWidth: 0,\s*\}/);
  assert.match(parts, /lineEnd: \{\s*flexShrink: 0,/);
  assert.equal(
    (source.match(/end=\{<Type variant="bodyStrong" numberOfLines=\{1\} style=\{rowStyles\.rowAmount\}>/g) ?? []).length,
    4,
    "every kind of row ends its first line with its amount",
  );

  // On the narrowest phones a date and a fee give way, never the status — and a
  // screen reader still hears both.
  assert.match(source, /\{rentStatus\(tenant\)\}\{due && !narrow \? ` · \$\{shortDate\(due\)\}` : ""\}/);
  assert.match(source, /end=\{narrow \? undefined : <Type variant="caption" numberOfLines=\{1\} style=\{rowStyles\.rowMeta\}>\{fee\}<\/Type>\}/);
  assert.match(source, /\$\{due \? ` Due \$\{shortDate\(due\)\}\.` : ""\}/);
  assert.match(source, /Tenant paid\. \$\{label\}\. \$\{formatMinor\(amount, settlement\.currency\)\}\. \$\{fee\}\./);
  assert.match(source, /const narrow = density\.veryCompact;/);
});

test("the page keeps everything it could do", () => {
  const source = screen();

  assert.match(source, /<FlatList/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /pathname: "\/\(app\)\/rent-account"/);
  assert.match(source, /disabled=\{!tenant\.lease_id\}/);
  assert.match(source, /\.sort\(\(a, b\) => rentPriority\(a\) - rentPriority\(b\) \|\| a\.name\.localeCompare\(b\.name, "en-GH"\)\)/);

  // Every list that can be searched still can, and says what it searches.
  assert.match(source, /\{view !== "expenses" \? <SearchField label=\{SEARCH\[view\]\.label\}/);
  for (const label of ["Search balances", "Search records", "Search payouts"]) {
    assert.match(source, new RegExp(`label: "${label}"`), label);
  }

  // Expenses are still recorded here, and "add" still opens the form.
  assert.match(source, /const \[showExpense, setShowExpense\] = useState\(action === "expense"\);/);
  assert.match(source, /<QuietAction icon="add" label="Record expense" onPress=\{\(\) => setShowExpense\(true\)\} \/>/);
  assert.match(source, /await recordPropertyExpense\(organizationId,/);
  assert.match(source, /\{canManagePayouts && organizationId \? <QuietAction icon="card-outline" label="Manage settlement account"/);
});

test("the words on glass read, and every status keeps its colour legibly", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
  const source = screen();
  const parts = kit();
  const rows = code(read("src/components/account/IndexRows.tsx"));

  const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const token = (family, step) => channels(tokens.color[family][step].value);
  const mix = (base, over, amount) => base.map((value, index) => value + (over[index] - value) * amount);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((value) => {
      const unit = value / 255;
      return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const number = (text, pattern) => Number(pattern.exec(text)?.[1]);

  const kola = token("kola", "600");
  const white = token("field", "0");
  const ink = token("ink", "900");
  const ground = mix(
    mix(token("field", "50"), kola, number(rows, /const FLOOR_OPACITY = ([\d.]+);/)),
    kola,
    number(rows, /const AURA_OPACITY = ([\d.]+);/),
  );
  const glass = mix(ground, white, number(parts, /export const GLASS = alpha\(WHITE, ([\d.]+)\);/));

  assert.ok(contrast(ink, glass) >= 12, "names and amounts on glass");
  for (const [name, pattern] of [["MUTED", /export const MUTED = alpha\(INK, ([\d.]+)\);/], ["FAINT", /export const FAINT = alpha\(INK, ([\d.]+)\);/]]) {
    assert.ok(contrast(mix(glass, ink, number(parts, pattern)), glass) >= 4.5, `${name} words on glass`);
  }

  // Each status colour, read from the kit, on the glass it is printed on.
  assert.match(source, /const STATUS_TONE[^;]*overdue: LATERITE,\s*outstanding: HARMATTAN,\s*current: KOLA,/);
  for (const [name, family] of [["LATERITE", "laterite"], ["HARMATTAN", "harmattan"], ["KOLA", "kola"], ["LAGOON", "lagoon"], ["KOLA_DEEP", "kola"]]) {
    const step = new RegExp(`export const ${name} = theme\\.color\\.${family}\\["(\\d+)"\\];`).exec(parts)?.[1];
    assert.ok(step, `${name} is not a ${family} token`);
    assert.ok(contrast(token(family, step), glass) >= 4.5, `${name} on glass`);
  }

  // In the sheet: counts on the choice panel, a chosen answer on its tint, and
  // the results button's words on kola.
  const muted = number(parts, /export const MUTED = alpha\(INK, ([\d.]+)\);/);
  assert.ok(contrast(mix(token("field", "50"), ink, muted), token("field", "50")) >= 4.5, "counts in the sheet");
  assert.ok(contrast(token("kola", "800"), token("kola", "50")) >= 4.5, "a chosen answer");
  assert.ok(contrast(white, kola) >= 4.5, "Show results on kola");
});
