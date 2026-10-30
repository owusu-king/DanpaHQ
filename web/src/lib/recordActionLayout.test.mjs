import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(source, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: (name) => imports[name] ?? {} });
  return exports;
}

function mount(path, imports, initial = []) {
  const values = [...initial];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = compile(readFileSync(new URL(path, import.meta.url), "utf8"), {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useEffect() {}, useCallback: (fn) => fn,
      useState(value) {
        const index = cursor++;
        if (!(index in values)) values[index] = value;
        return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
      },
    },
    "@/components/Button": { Button: "Button" },
    "@/components/Notice": { Notice: "Notice" },
    "@/components/workspace/ModalSheet": { ModalSheet: "ModalSheet" },
    "@/lib/api": { ApiFailure: class extends Error {} },
    ...imports,
  });
  return (name, props) => { cursor = 0; return exports[name](props); };
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const soldModal = (tree) => find(tree, (node) => node.type === "ModalSheet");
const actions = (tree) => find(tree, (node) => node.props?.className === "sale-panel-actions");
const button = (tree, label) => find(tree, (node) => node.type === "Button" && node.props.children === label);

function salePanel(setSaleStatus) {
  const render = mount("../components/property/SalePanel.tsx", {
    "@/lib/sales": { setSaleStatus, saleFacts: () => [], COMMERCIAL_USES: [], LAND_UNITS: [] },
    "./PropertyWizard": { PropertyWizardModal: "PropertyWizardModal" },
  });
  const props = {
    propertyId: "property-1", verified: true,
    sale: { status: "active", is_public: true, enquiry_count: 2, editable_fields: ["description"] },
    onChanged: async () => {},
  };
  return { props, render: () => render("SalePanel", props) };
}

test("Mark as sold opens a small confirmation without changing the page's action row", () => {
  let writes = 0;
  const screen = salePanel(async () => { writes++; });
  const before = screen.render();
  const labels = actions(before).props.children.filter(Boolean).map((node) => node.props.children);
  button(actions(before), "Mark as sold").props.onClick();
  const after = screen.render();
  assert.deepEqual(actions(after).props.children.filter(Boolean).map((node) => node.props.children), labels);
  assert.equal(writes, 0);
  assert.equal(soldModal(after).props.open, true);
  assert.equal(soldModal(after).props.size, "sm");
  assert.equal(soldModal(after).props.className, "compact-action-sheet");
  button(soldModal(after), "Cancel").props.onClick();
  assert.equal(soldModal(screen.render()).props.open, false);
  assert.equal(writes, 0);
});

test("only confirmation marks the property sold and pending requests disable the actions", async () => {
  const calls = [];
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const screen = salePanel(async (...args) => { calls.push(args); await pending; });
  let refreshed = 0;
  screen.props.onChanged = async () => { refreshed++; };
  button(actions(screen.render()), "Mark as sold").props.onClick();
  const request = button(soldModal(screen.render()), "Mark as sold").props.onClick();
  const waiting = screen.render();
  assert.deepEqual(calls, [["property-1", "sold"]]);
  assert.equal(button(soldModal(waiting), "Mark as sold").props.busy, true);
  assert.equal(button(soldModal(waiting), "Cancel").props.disabled, true);
  assert.ok(actions(waiting).props.children.filter(Boolean).every((node) => node.props.disabled));
  resolve();
  await request;
  assert.equal(soldModal(screen.render()).props.open, false);
  assert.equal(refreshed, 1);
});

test("a failed sold request keeps the confirmation and its error visible", async () => {
  const screen = salePanel(async () => { throw new Error("Offline"); });
  button(actions(screen.render()), "Mark as sold").props.onClick();
  await button(soldModal(screen.render()), "Mark as sold").props.onClick();
  const failed = screen.render();
  assert.equal(soldModal(failed).props.open, true);
  assert.equal(find(soldModal(failed), (node) => node.type === "Notice").props.title, "That did not go through.");
  assert.equal(button(soldModal(failed), "Mark as sold").props.busy, false);
  button(soldModal(failed), "Cancel").props.onClick();
  assert.equal(find(screen.render(), (node) => node.type === "Notice"), undefined);
});

const { privateAccess } = compile(readFileSync(new URL("./accessCodeMeaning.ts", import.meta.url), "utf8"));

function unitRecord(space) {
  const render = mount("../../app/record/space/page.tsx", {
    "next/navigation": { useRouter: () => ({}), useSearchParams: () => new URLSearchParams("propertyId=property-1&spaceId=unit-1") },
    "@/lib/accessCodeMeaning": { privateAccess },
    "@/components/property/WorkspacePatterns": {
      spaceStatus: () => ({ tone: "neutral" }), DetailSection: "DetailSection", DetailDisclosure: "DetailDisclosure",
    },
    "@/components/property/RecordDetail": { RecordSection: "RecordSection", RecordHero: "RecordHero", RecordHeader: "RecordHeader" },
  }, [space, null, ""]);
  return render("default");
}

function savedUnit() {
  return {
    id: "unit-1", label: "Room A", description: "A bright room", space_type: "room", space_type_label: "Room",
    property: { id: "property-1", title: "The property", property_type: "house" },
    verification: { state: "ready_for_submission", editable: true }, publication: { state: "private" },
    availability: { state: "available", label: "Available" }, media: [], floor_level: 0,
    amenities: [{ id: "amenity-1", name: "Balcony" }], beds: [],
    access_code: { state: "unavailable" }, permitted_actions: { edit: { allowed: true } },
  };
}

test("unfinished Units show saved amenities and description without duplicate inline editors or an empty access card", () => {
  const tree = unitRecord(savedUnit());
  const chips = find(tree, (node) => node.props?.className === "pd-chips");
  assert.equal(chips.props.children[0].props.children, "Balcony");
  assert.equal(find(tree, (node) => node.props?.className === "record-description").props.children, "A bright room");
  assert.equal(find(tree, (node) => ["SpaceAmenities", "SpaceDetails", "Field"].includes(node.type?.name) || node.type === "textarea"), undefined);
  assert.equal(find(tree, (node) => node.type === "RecordSection" && node.props.title === "Access and verification"), undefined);
  assert.ok(find(tree, (node) => node.type?.name === "WhatIsNext"));
});

test("bed management stays available in a collapsed disclosure and verified Units retain access management", () => {
  const space = savedUnit();
  space.property.property_type = "hostel";
  space.verification.state = "verified";
  space.access_code.state = "active";
  const tree = unitRecord(space);
  const beds = find(tree, (node) => node.type === "DetailDisclosure" && node.props.title === "Beds");
  assert.notEqual(beds.props.open, true);
  assert.equal(beds.props.children.type.name, "Beds");
  assert.ok(find(tree, (node) => node.type === "RecordSection" && node.props.title === "Access and verification"));
});
