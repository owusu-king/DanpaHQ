/**
 * Plan & billing, refined on review (2026-09-15).
 *
 * The page says what plan, how it stands and what was paid at a glance, and keeps
 * everything longer one tap away. These tests hold that — a few recent rows, the
 * rest in the shared scrolling sheet — and that nothing the page could do was
 * lost on the way: every payment with its status and receipt, every plan event,
 * every restricted place with the way back, and the plan's one next step.
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
const page = () => code(read("app/(app)/billing.tsx"));
const card = () => code(read("src/components/billing/CurrentPlanCard.tsx"));
const records = () => code(read("src/components/billing/BillingRecords.tsx"));
const restricted = () => code(read("src/components/billing/RestrictedResources.tsx"));
const surfaces = () => code(read("src/components/billing/BillingSurfaces.tsx"));

test("long lists show their latest few, and the rest open in the shared scrolling sheet", () => {
  const parts = surfaces();
  assert.match(parts, /export const PREVIEW = \{ payments: 3, history: 2, restricted: 3 \} as const;/);
  assert.match(between(parts, "export function ViewAll(", "export function Fact("), /`View all \$\{count\} \$\{noun\}`/);

  const source = records();
  // Newest first, then the first few; every one of them in the sheet.
  assert.match(source, /\[\.\.\.billing\.invoices\]\.sort\(\(a, b\) => whenOf\(b\)\.localeCompare\(whenOf\(a\)\)\)/);
  assert.match(source, /records\.slice\(0, PREVIEW\.payments\)\.map\(/);
  assert.match(source, /\{records\.length > PREVIEW\.payments \? <ViewAll count=\{records\.length\} noun="payments" onPress=\{\(\) => setSheet\("payments"\)\} \/> : null\}/);
  assert.match(
    source,
    /<BottomSheet visible=\{sheet === "payments"\} onClose=\{\(\) => setSheet\(null\)\} title="Payments" closeLabel="Close payments">[\s\S]*?\{records\.map\(\(record, index\) => <PaymentRow/,
  );

  // Plan history: the latest events, all of them on request.
  assert.match(source, /\[\.\.\.billing\.history\]\.sort\(\(a, b\) => b\.occurred_at\.localeCompare\(a\.occurred_at\)\)/);
  assert.match(source, /history\.slice\(0, PREVIEW\.history\)\.map\(/);
  assert.match(source, /\{history\.length > PREVIEW\.history \? <ViewAll count=\{history\.length\} noun="events" onPress=\{\(\) => setSheet\("history"\)\} \/> : null\}/);
  assert.match(source, /title="Plan history" closeLabel="Close plan history">[\s\S]*?\{history\.map\(/);
  assert.doesNotMatch(source, /<Disclosure/);

  // Restricted places: the first few, and all of them — with the same way back — in the sheet.
  const held = restricted();
  assert.match(held, /const shown = access\.restricted\.slice\(0, PREVIEW\.restricted\);/);
  assert.match(held, /\{shown\.map\(\(resource, index\) => row\(resource, index \+ 1\)\)\}/);
  assert.match(held, /\{access\.restricted\.length > PREVIEW\.restricted \? \(\s*<ViewAll count=\{access\.restricted\.length\} noun="restricted" onPress=\{\(\) => setAll\(true\)\} \/>/);
  assert.match(held, /<BottomSheet visible=\{all\} onClose=\{\(\) => setAll\(false\)\}[\s\S]*?\{access\.restricted\.map\(\(resource, index\) => row\(resource, index\)\)\}/);

  // The sheet is the shared one: it scrolls, and a thumb puts it away.
  for (const text of [source, held]) {
    assert.match(text, /import \{ BottomSheet \} from "@\/components\/sheet\/BottomSheet";/);
  }
});

test("each payment keeps what it said: what, how much, when, how it went, why it failed, and its receipt", () => {
  const source = records();
  const row = between(source, "function PaymentRow(", "function ReceiptButton(");
  assert.match(row, /\{invoiceDescription\(record\)\}/);
  assert.match(row, /\{formatAmount\(record\.amount_minor, record\.currency\)\}/);
  // When and what it covered; the invoice number on the last line, beside its receipt, said once.
  assert.match(row, /const when = paymentFacts\(record\)\.filter\(\(fact\) => fact !== record\.number\)\.join\(" · "\);/);
  assert.match(row, /start=\{<Type variant="caption" numberOfLines=\{2\} style=\{styles\.facts\}>\{when\}<\/Type>\}/);
  assert.match(row, /style=\{styles\.number\}>\{record\.number\}<\/Type>/);
  assert.match(row, /<ToneWord tone=\{status\.tone\} label=\{status\.label\} \/>/);
  assert.match(row, /\{failed && record\.payment\.failure_message \? \(/);
  assert.match(row, /\{record\.payment\.receipt_id \? <ReceiptButton receiptId=\{record\.payment\.receipt_id\} number=\{record\.number\} \/> : null\}/);
  // The amount and the status end their lines, which never cut them short.
  assert.match(row, /<RowLine\s+start=/);

  const receipt = between(source, "function ReceiptButton(", "function HistoryRow(");
  assert.match(receipt, /await shareReceiptDocument\(receiptId, number\);/);
  assert.match(receipt, /accessibilityLabel=\{`Receipt for \$\{number\}`\}/);

  // Invoices only for somebody allowed to read them; the sheet leads with how many, and what was paid.
  assert.match(source, /billing\.viewer\.can_view_invoices \? \[\.\.\.billing\.invoices\]/);
  assert.match(source, /<SheetList summary=\{paidSummary\(records\)\}>/);
  assert.match(source, /if \(currencies\.size !== 1 \|\| !succeeded\.length\) return count;/);
  // A single "started on Free" line is still not history.
  assert.match(source, /billing\.history\.length > 1 \?/);
});

test("the plan leads, with its standing as a word and one next step", () => {
  const source = card();
  assert.match(source, /const standing = standingOf\(billing, catalogue\);/);
  assert.match(source, /\{standing\.badge \? <StatusBadge tone=\{standing\.badge\.tone\} label=\{standing\.badge\.label\} \/> : null\}/);
  assert.match(source, /<Type variant="caption" style=\{styles\.line\}>\{standing\.line\}<\/Type>/);
  assert.match(source, /complimentary \? \(\s*<Type variant="amountLg" style=\{styles\.price\}>No charge<\/Type>/);

  // Anything that needs a person sits under the standing line with its one act, and Change plan steps down for it.
  assert.match(source, /const actionLeads = Boolean\(action && action\.kind !== "keep"\);/);
  assert.match(source, /<Pill label="Change plan" icon="swap-vertical-outline" tone=\{actionLeads \? "quiet" : "primary"\} onPress=\{onChangePlan\} \/>/);
  assert.match(source, /busy=\{busyAction === action\.kind\}/);

  // The rung picks the glyph, never a plan's name.
  assert.match(source, /plan\.rank >= 2/);

  // Usage is the same surface's quieter zone, and each count is said whole.
  assert.match(source, /\{meters\.map\(\(meter, index\) => <MeterLine key=\{meter\.key\} meter=\{meter\} first=\{index === 0\} \/>\)\}/);
  assert.match(source, /accessibilityLabel=\{`\$\{meter\.name\}: \$\{meter\.valueText\}\. \$\{meter\.note\}\.`\}/);

  // The plan's description is the plans screen's to say.
  assert.doesNotMatch(source, /plan\.description/);
});

test("billing terms stay a few facts, for a paid subscription only, with Pay early where it is allowed", () => {
  const source = records();
  const terms = between(source, "function BillingTerms(", "function PaymentRow(");
  for (const label of ["Billing cycle", "Next payment", "Last paid with", "Billing email"]) {
    assert.match(terms, new RegExp(`label="${label}"`), label);
  }
  assert.match(terms, /const canPayEarly =\s*billing\.renewal\.available && !lapsed && billing\.viewer\.can_change_plan && billing\.checkout\.available;/);
  assert.match(terms, /action=\{canPayEarly \? <SmallAct label="Pay early" onPress=\{onPayEarly\} \/> : null\}/);
  assert.match(source, /\{paid && subscription \? \(/);
});

test("the page keeps every state and every act it had", () => {
  const source = page();
  assert.match(source, /useFocusEffect\(\s*useCallback\(\(\) => \{\s*void load\(\);\s*\}, \[load\]\),\s*\);/);
  assert.match(source, /refreshControl=\{\s*<RefreshControl/);
  assert.match(source, /\{feedback \? <Notice tone=\{feedback\.tone\} title=\{feedback\.title\} body=\{feedback\.body\} \/> : null\}/);
  assert.match(source, /title="Plan & billing didn't load"/);
  assert.match(source, /<QuietAction icon="refresh" label="Try again" onPress=\{\(\) => void load\(\)\} \/>/);
  assert.match(source, /title="Plan & billing is kept to the Portfolio's owner, administrators and accountants"/);
  assert.match(source, /title="No Portfolio yet"/);
  assert.match(source, /const next = await keepCurrentPlan\(organization\.id\);/);
  for (const route of ["billing-payment", "billing-review", "billing-plans"]) {
    assert.match(source, new RegExp(`pathname: "/\\(app\\)/${route}"`), route);
  }
  assert.match(source, /onPayEarly=\{\(\) => void act\(\{ kind: "renew", label: "" \}\)\}/);
  // A refresh that fails keeps what the page last knew.
  assert.match(source, /setScreen\(\(current\) => \(current\.status === "ready" \? current : \{ status: "error", message \}\)\);/);
});

test("the words on glass read, and every tone keeps its colour legibly", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
  const kit = code(read("src/components/portfolio/PortfolioList.tsx"));
  const rows = code(read("src/components/account/IndexRows.tsx"));
  const parts = code(read("src/components/billing/BillingParts.tsx"));

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
  const ground = mix(
    mix(token("field", "50"), kola, number(rows, /const FLOOR_OPACITY = ([\d.]+);/)),
    kola,
    number(rows, /const AURA_OPACITY = ([\d.]+);/),
  );
  const glass = mix(ground, white, number(kit, /export const GLASS = alpha\(WHITE, ([\d.]+)\);/));

  // Every status word: on its own wash as a badge, and on glass beside a payment or a place.
  const tones = [...parts.matchAll(/(\w+): \{ fg: theme\.color\.(\w+)\["(\d+)"\], bg: theme\.color\.(\w+)\["(\d+)"\], rule:/g)];
  assert.equal(tones.length, 5, "positive, neutral, info, warning and critical");
  for (const [, name, fgFamily, fgStep, bgFamily, bgStep] of tones) {
    const fg = token(fgFamily, fgStep);
    assert.ok(contrast(fg, token(bgFamily, bgStep)) >= 4.5, `${name} on its wash`);
    assert.ok(contrast(fg, glass) >= 4.5, `${name} as a word on glass`);
  }
  assert.match(between(surfaces(), "export function ToneWord(", "export function SheetList("), /color: TONES\[tone\]\.fg/);

  // The leading act's white words on kola; the quieter act's deep kola on its tint.
  assert.match(surfaces(), /const ink = primary \? WHITE : KOLA_DEEP;/);
  assert.match(surfaces(), /pillPrimary: \{\s*backgroundColor: KOLA,\s*\}/);
  assert.ok(contrast(white, kola) >= 4.5, "white on kola");
  assert.ok(contrast(token("kola", "800"), token("kola", "50")) >= 4.5, "deep kola on its tint");
});
