import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = readFileSync(new URL("../components/property/WorkspacePatterns.tsx", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: () => ({}) });

test("sale edits reuse the creation modal and form, including the backend's field permissions", () => {
  const exports = {};
  const source = readFileSync(new URL("../components/property/PropertyWizard.tsx", import.meta.url), "utf8");
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    require: (name) => ({
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: { useState: () => ["", () => {}], useRef: (current) => ({ current }), useEffect() {} },
      "@/components/property/SaleDetailsForm": { SaleDetailsForm: "SaleDetailsForm" },
    })[name] ?? {},
  });
  const sale = { editable_fields: ["price_minor", "headline", "description"] };
  let refreshed = false, closed = false;
  const sheet = exports.PropertyWizardModal({ open: true, propertyId: "property-1", sale, onChanged: () => { refreshed = true; } });
  assert.equal(sheet.props.title, "Edit sale details");
  assert.equal(sheet.props.dismissible, false);
  const editor = sheet.props.children(() => { closed = true; });
  assert.equal(editor.type, "SaleDetailsForm");
  assert.equal(editor.props.sale, sale);
  assert.equal(editor.props.propertyId, "property-1");
  editor.props.onSaved();
  assert.equal(refreshed, true);
  assert.equal(closed, true);
});

test("record statuses never call a suspended advertisement public or an expired offer available", () => {
  const unit = { verification: { state: "verified" }, availability: { state: "available" }, publication: { state: "published", listing_status: "suspended" } };
  assert.doesNotMatch(exports.spaceStatus(unit).label, /Public/);
  unit.publication.listing_status = "active";
  assert.match(exports.spaceStatus(unit).label, /Public/);
  unit.availability.state = "expired";
  assert.match(exports.spaceStatus(unit).label, /Expired/);
  assert.doesNotMatch(exports.spaceStatus(unit).label, /Available|Public/);
  unit.availability.state = "occupied";
  assert.equal(exports.spaceStatus(unit).label, "Occupied");
});

test("record details pass photos and video into one property media gallery", () => {
  const exports = {};
  const source = readFileSync(new URL("../components/property/RecordDetail.tsx", import.meta.url), "utf8");
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    require: (name) => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {},
  });
  const photos = [{ id: "a", url: "/a.jpg", label: "Front" }];
  const video = { id: "clip", url: "/unit.mp4" };
  const hero = exports.RecordHero({ photos, video, title: "Unit", children: null });
  const gallery = hero.props.children[0];
  assert.equal(gallery.props.photos, photos);
  assert.equal(gallery.props.videos[0].video, video);
});

test("one media viewer browses photos and videos, including video-only records", () => {
  const exports = {};
  const source = readFileSync(new URL("../components/property/MediaGallery.tsx", import.meta.url), "utf8");
  const jsx = (type, props) => ({ type, props });
  let selected = 0;
  let viewing = false;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    require: (name) => ({
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: { useState: (initial) => typeof initial === "number"
        ? [selected, (value) => { selected = value; }]
        : [viewing, (value) => { viewing = value; }],
        useRef: () => ({ current: null }), useEffect() {} },
      "./WalkthroughVideo": { VideoPlayer: "VideoPlayer" },
    })[name] ?? {},
  });
  const unit = { label: "Unit video", video: { id: "unit", url: "/unit.mp4" } };
  const property = { label: "Property video", video: { id: "property", url: "/property.mp4" } };
  const photos = [{ id: "a", url: "/a.jpg", label: "Front" }];
  const args = { photos, videos: [unit, property], empty: "No property media on file" };
  const initial = exports.MediaGallery(args).props.children;
  const tiles = initial[1].props.children;
  assert.equal(tiles.length, 3);
  assert.equal(initial[2].type, "dialog");
  assert.equal(initial[2].props.children, null);
  tiles[1].props.onClick();
  const inline = exports.MediaGallery(args).props.children[0];
  assert.equal(inline.props.children[0].props.video, unit.video);
  inline.props.children[1].props.onClick();
  assert.equal(exports.MediaGallery(args).props.children[0].props.children[0], null);
  let modal = exports.MediaGallery(args).props.children[2];
  assert.ok(modal.props.children);
  assert.equal(modal.props.children.props.children[0].props.children[0].props.video, unit.video);
  modal.props.children.props.children[0].props.children[1].props.children[1].props.onClick();
  modal = exports.MediaGallery(args).props.children[2];
  assert.equal(modal.props.children.props.children[0].props.children[0].props.video, property.video);
  modal.props.onClose();
  assert.equal(exports.MediaGallery(args).props.children[2].props.children, null);

  selected = 5;
  const reduced = exports.MediaGallery(args).props.children[0];
  assert.equal(reduced.props.children[0].props.children.props.src, "/a.jpg");
  selected = 0;
  const videoOnly = exports.MediaGallery({ ...args, photos: [], videos: [unit] }).props.children;
  assert.equal(videoOnly[1], null);
  assert.equal(videoOnly[0].props.children[0].props.video, unit.video);
  videoOnly[0].props.children[1].props.onClick();
  assert.ok(exports.MediaGallery({ ...args, photos: [], videos: [unit] }).props.children[2].props.children);
  assert.equal(exports.MediaGallery({ ...args, photos: [], videos: [] }).props.children[0], args.empty);

  viewing = false;
  const tools = { type: "listing-tools" };
  const mosaic = exports.MediaGallery({ ...args, layout: "listing", tools }).props.children;
  assert.equal(mosaic[0].props.children.length, 3);
  assert.equal(mosaic[1].props.children[0], tools);
  mosaic[0].props.children[1].props.onClick();
  const viewer = exports.MediaGallery({ ...args, layout: "listing", tools }).props.children[2];
  assert.ok(viewer.props.children);
  assert.equal(viewer.props.children.props.children[0].props.children[0].props.video, unit.video);
});
