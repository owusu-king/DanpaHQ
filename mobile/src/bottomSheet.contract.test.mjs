/**
 * The swipeable sheet, and Explore's filters in it.
 *
 * The filter sheet had a grab handle and no gesture behind it: a transparent
 * Modal that slid up with its scrim, closable only by its buttons or a tap on the
 * scrim. On iOS that is not how a sheet behaves, and on Android the handle was a
 * promise the sheet did not keep.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const sheet = () => code(read("src/components/sheet/BottomSheet.tsx"));
const search = () => code(read("app/(app)/search.tsx"));

test("Explore's filters open in the one sheet a thumb can put away", () => {
  const screen = search();
  assert.match(screen, /import \{ BottomSheet \} from "@\/components\/sheet\/BottomSheet";/);
  assert.match(screen, /<BottomSheet\s+visible=\{visible\}\s+onClose=\{onClose\}\s+title="Filters"\s+hideTitle\s+closeLabel="Close filters"/);
  // The screen no longer builds a modal of its own.
  assert.doesNotMatch(screen, /<Modal/);
});

test("only the handle drags it, as WhatsApp's sheets do", () => {
  const source = sheet();

  // One responder, on the handle: the full width of the sheet's top, a thumb's
  // height, and — when there is no title — the close button's row too (owner,
  // 2026-09-28). It claims any vertical drag that starts there.
  assert.match(source, /const grab = useMemo\(\(\) => \{/);
  assert.match(source, /onMoveShouldSetPanResponderCapture: \(_, gesture\) => vertical\(gesture\)/);
  // It owns the touch from the moment it lands, as Explore's grabber does. Taken
  // only on the first move, a handle with nothing under the finger to take it
  // from never began a drag inside the sheet's modal on a phone (owner,
  // 2026-09-28: "all the other filters don't allow handle swipe down").
  assert.match(source, /onStartShouldSetPanResponder: \(\) => true,/);
  assert.equal((source.match(/\{\.\.\.grab\.panHandlers\}/g) ?? []).length, 1);
  assert.match(source, /<View collapsable=\{false\} style=\{\[styles\.handle, hideTitle \? styles\.handleWithClose : null\]\} \{\.\.\.grab\.panHandlers\}>/);
  assert.match(source, /const HANDLE_HEIGHT = 28;/);

  // The body never drags the sheet: a drag there scrolls or works the control
  // under the finger, and nothing has to guess which was meant.
  assert.doesNotMatch(source, /pull\.panHandlers|scrollTop|overflows/);
  assert.match(source, /<View style=\{styles\.body\}>/);
  assert.match(source, /const DRAG_SLOP = 4;/);
  assert.equal((source.match(/collapsable=\{false\}/g) ?? []).length, 1);

  // Once the sheet is moving, nothing inside it can take the drag away, and a
  // cancelled drag still settles somewhere.
  assert.match(source, /onPanResponderTerminationRequest: \(\) => false/);
  assert.match(source, /onPanResponderTerminate: \(_, gesture\) => settle\(gesture\)/);
  // While it moves, the scroll view stands still and draws no bounce or glow.
  assert.match(source, /scrollEnabled=\{!dragging\}/);
  assert.match(source, /bounces=\{false\}/);
  assert.match(source, /overScrollMode="never"/);
});

test("it lets go past a quarter of itself or on a flick, and otherwise returns", () => {
  const source = sheet();

  assert.match(source, /const DISMISS_SHARE = 0\.25;/);
  assert.match(source, /const DISMISS_DISTANCE = 160;/);
  assert.match(source, /const DISMISS_VELOCITY = 0\.8;/);
  assert.match(source, /const letGo = Math\.min\(travel\.current \* DISMISS_SHARE, DISMISS_DISTANCE\);/);
  assert.match(source, /if \(position > letGo \|\| \(gesture\.vy > DISMISS_VELOCITY && gesture\.dy > 0\)\) \{/);
  assert.match(source, /close\.current\(\);/);

  // Short of that it springs home carrying the finger's speed, and never past home.
  assert.match(source, /Animated\.spring\(translate, \{\s*toValue: 0,\s*velocity: gesture\.vy \* 1000,\s*overshootClamping: true,/);
  // A pull upwards gives a little, and then holds.
  assert.match(source, /-OVERPULL \* \(1 - Math\.exp\(next \/ OVERPULL\)\)/);
});

test("the sheet rises and falls itself, over a scrim that follows it", () => {
  const source = sheet();

  // Not the Modal's own slide, which carried the scrim up with the sheet.
  assert.match(source, /<Modal visible transparent animationType="none"/);
  assert.match(source, /outputRange: \[1, 0\]/);
  assert.match(source, /opacity: scrim/);
  // It falls from wherever the finger left it, at least as fast as the finger
  // was going, and is only unmounted once it has gone.
  assert.match(source, /const speed = Math\.max\(releaseSpeed\.current, travel\.current \/ motion\.duration\.base\);/);
  assert.match(source, /if \(finished\) setMounted\(false\);/);

  // Motion is offered, never imposed.
  assert.match(source, /useReduceMotion\(\)/);
  assert.match(source, /useNativeDriver: true/);
});

test("it is safe at every edge and closable every way", () => {
  const source = sheet();

  // Never under the status bar, and its actions clear of the home indicator —
  // both measured in the sheet's own window, which is not the page's. See
  // `safeEdges.contract.test.mjs` for why that distinction is the whole fix.
  assert.match(source, /maxHeight: windowHeight - safeHeaderTop\(edge\.top\) - space\[3\],/);
  assert.match(source, /paddingBottom: Math\.max\(edge\.bottom, space\[4\]\)/);
  assert.match(source, /behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/);

  // The back button, the scrim, the close button and VoiceOver's escape all close it.
  assert.match(source, /onRequestClose=\{onClose\}/);
  assert.match(source, /onAccessibilityEscape=\{onClose\}/);
  assert.match(source, /accessibilityViewIsModal/);
  // The scrim, and the close button in whichever row it sits: beside the title,
  // or on the handle's row when the title is not drawn.
  assert.equal((source.match(/accessibilityLabel=\{closeLabel\}/g) ?? []).length, 3);

  // The footer's pills stand a little above the home indicator or navigation
  // bar rather than on it (owner, 2026-09-28).
  assert.match(source, /const FOOTER_LIFT = space\[3\];/);
  assert.match(source, /paddingBottom: Math\.max\(edge\.bottom, space\[4\]\) \+ FOOTER_LIFT/);

  // A sheet can draw no title and still be named to a screen reader.
  assert.match(source, /accessibilityLabel=\{hideTitle \? title : undefined\}/);
  assert.match(source, /\{hideTitle \? null : \(\s*<View style=\{styles\.header\}>/);

  // Grabbing it puts the keyboard away rather than dragging a field with it.
  assert.match(source, /Keyboard\.dismiss\(\);/);
});
