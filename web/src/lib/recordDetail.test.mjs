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
      "@/components/workspace/ModalSheet": { ModalSheet: "ModalSheet" },
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

test("the gallery keeps its image, count and thumbnail consistent after a selected photo disappears", () => {
  const exports = {};
  const source = readFileSync(new URL("../components/property/RecordDetail.tsx", import.meta.url), "utf8");
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    require: (name) => name === "react" ? { useState: (initial) => [initial === 0 ? 5 : false, () => {}] } : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {},
  });
  const photos = [{ id: "a", url: "/a.jpg", label: "Front" }, { id: "b", url: "/b.jpg", label: "Room" }];
  const gallery = exports.RecordHero({ photos, title: "A property with a deliberately long name that must remain readable", children: null });
  const media = gallery.props.children[0];
  const imageButton = media.props.children[0];
  assert.equal(imageButton.props.children[0].props.src, "/a.jpg");
  assert.equal(imageButton.props.children[1].props.children, "1 / 2");
  assert.equal(media.props.children[1].props.children[0].props["aria-pressed"], true);
  assert.equal(exports.RecordHero({ photos: [], title: "No photo", children: null }).props.children[0].props.children[0].props.children, "No photo on file");
});

test("signing back in from a record retains the property and unit identifiers", () => {
  const exports = {};
  const source = readFileSync(new URL("../components/portal/PortalGate.tsx", import.meta.url), "utf8");
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    require: (name) => ({
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: { Suspense: "Suspense", useState: () => [false, () => {}] },
      "next/navigation": { usePathname: () => "/record/space", useSearchParams: () => new URLSearchParams("propertyId=property-1&spaceId=unit-2") },
      "@/lib/session": { useSession: () => ({ state: { status: "signed_out" } }) },
      "@/components/auth/AuthDialog": { AuthLink: "AuthLink" },
    })[name] ?? {},
  });
  const suspense = exports.PortalGate();
  const content = suspense.props.children.type();
  const actions = content.props.children.find((node) => node.props?.className === "portal-gate-actions");
  assert.equal(actions.props.children[0].props.params.next, "/record/space?propertyId=property-1&spaceId=unit-2");
});
