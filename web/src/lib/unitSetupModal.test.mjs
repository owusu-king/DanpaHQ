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

const { inPlace } = compile(readFileSync(new URL("./inPlace.ts", import.meta.url), "utf8"));

function mount(route = false, extra = {}) {
  const values = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const source = readFileSync(new URL(route ? "../../app/record/space-new/page.tsx" : "../../app/record/space/page.tsx", import.meta.url), "utf8");
  const exports = compile(source + (route ? "\nexports.NewSpace = NewSpace;" : "\nexports.WhatIsNext = WhatIsNext; exports.SubmitForChecking = SubmitForChecking;"), {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      Suspense: "Suspense", useEffect() {},
      useState(initial) {
        const index = cursor++;
        if (!(index in values)) values[index] = initial;
        return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
      },
      useRef(initial) {
        const index = cursor++;
        return values[index] ??= { current: initial };
      },
    },
    "next/link": { default: "Link" },
    "@/components/Button": { Button: "Button" },
    "@/components/workspace/ModalSheet": { ModalSheet: "ModalSheet" },
    "@/components/property/UnitWizardModal": { UnitWizardModal: "UnitWizardModal" },
    "@/components/workspace/Workspace": { WorkspaceHead: "WorkspaceHead" },
    "@/components/Notice": { Notice: "Notice" },
    "@/components/PageTitle": { usePageTitle() {} },
    "@/lib/inPlace": { inPlace },
    ...extra,
  });
  return { render(name, props) { cursor = 0; return exports[name](props); } };
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const modal = (tree) => find(tree, (node) => node.type === "UnitWizardModal");
const continuation = (tree) => find(tree, (node) => node.props?.children === "Continue setup");
const editAction = (tree) => find(tree, (node) => node.props?.children === "Edit Unit");
const click = (overrides = {}) => ({ button: 0, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...overrides });

function unit(state = "ready_for_submission", editable = true) {
  return {
    id: "unit-1", property: { id: "property-1" }, amenities: [], photo_count: 0,
    availability: { state: "available" }, publication: { state: "private" },
    verification: { state, editable, can_submit: true, required_outstanding: 0, required_total: 1 },
    permitted_actions: { edit: { allowed: editable }, submit_for_verification: { allowed: true } },
  };
}
const props = (space) => ({ space, listing: null, propertyId: "property-1", onChanged: async () => {} });

test("the Unit record opens the shared edit modal directly at Details", () => {
  const screen = mount();
  const input = props(unit("draft"));
  const edit = editAction(screen.render("WhatIsNext", input));
  assert.equal(edit.props.href, "/record/space-new?propertyId=property-1&unitId=unit-1&step=details");
  const modified = click({ ctrlKey: true });
  edit.props.onClick(modified);
  assert.equal(modified.prevented, false);
  assert.equal(modal(screen.render("WhatIsNext", input)).props.open, false);
  const event = click();
  edit.props.onClick(event);
  assert.equal(event.prevented, true);
  const setup = modal(screen.render("WhatIsNext", input));
  assert.equal(setup.props.mode, "edit");
  assert.equal(setup.props.unitId, "unit-1");
  assert.equal(setup.props.startAt, "details");
  assert.equal(setup.props.open, true);
  setup.props.onClose();
  assert.equal(modal(screen.render("WhatIsNext", input)).props.open, false);
});

test("all editable review outcomes resume the same saved Unit in a modal", () => {
  for (const state of ["draft", "ready_for_submission", "changes_requested", "rejected", "expired"]) {
    const screen = mount();
    const input = props(unit(state));
    const event = click();
    continuation(screen.render("WhatIsNext", input)).props.onClick(event);
    const setup = modal(screen.render("WhatIsNext", input));
    assert.equal(event.prevented, true, state);
    assert.equal(setup.props.open, true, state);
    assert.equal(setup.props.unitId, "unit-1");
    assert.equal(setup.props.propertyId, "property-1");
    assert.equal(setup.props.startAt, "review");
    setup.props.onClose();
    assert.equal(modal(screen.render("WhatIsNext", input)).props.open, false);
  }
});

test("withdrawing refreshes the review state and makes modal setup available again", async () => {
  const space = unit("submitted", false);
  let withdrawn = "";
  const screen = mount(false, { "@/lib/console": { withdrawSpaceSubmission: async (id) => { withdrawn = id; } } });
  const input = { ...props(space), onChanged: async () => {
    space.verification.state = "ready_for_submission";
    space.verification.editable = true;
    space.permitted_actions.edit.allowed = true;
  } };
  const before = screen.render("WhatIsNext", input);
  assert.equal(continuation(before), undefined);
  await find(before, (node) => node.type?.name === "SubmitForChecking").props.onWithdraw();
  assert.equal(withdrawn, "unit-1");
  continuation(screen.render("WhatIsNext", input)).props.onClick(click());
  assert.equal(modal(screen.render("WhatIsNext", input)).props.unitId, space.id);
  assert.equal(modal(screen.render("WhatIsNext", input)).props.open, true);
});

test("missing photos open the photos step in place and modified clicks retain a real URL", () => {
  const screen = mount();
  const space = unit("draft");
  space.verification.can_submit = false;
  space.verification.required_outstanding = 1;
  space.permitted_actions.submit_for_verification = { allowed: false, blockers: [] };
  const input = props(space);
  const tree = screen.render("WhatIsNext", input);
  const link = continuation(tree);
  const modified = click({ ctrlKey: true });
  link.props.onClick(modified);
  assert.equal(modified.prevented, false);
  assert.match(link.props.href, /unitId=unit-1&step=amenities$/);
  assert.equal(modal(screen.render("WhatIsNext", input)).props.open, false);
  const submission = find(tree, (node) => node.type?.name === "SubmitForChecking");
  const child = mount().render("SubmitForChecking", submission.props);
  find(child, (node) => node.props?.children === "Add the photos").props.onClick(click());
  assert.equal(modal(screen.render("WhatIsNext", input)).props.startAt, "photos");
  assert.equal(modal(screen.render("WhatIsNext", input)).props.open, true);
});

test("checked and queued Units do not gain an edit shortcut", () => {
  for (const state of ["verified", "submitted", "under_review", "suspended"]) {
    const tree = mount().render("WhatIsNext", props(unit(state, false)));
    assert.equal(continuation(tree), undefined);
    assert.equal(editAction(tree), undefined);
  }
  const denied = unit("draft");
  denied.permitted_actions.edit.allowed = false;
  assert.equal(editAction(mount().render("WhatIsNext", props(denied))), undefined);
});

test("bookmarked setup URLs use the modal and return to the correct record on close or finish", () => {
  for (const id of [null, "unit-1"]) {
    const destinations = [];
    const search = new URLSearchParams({ propertyId: "property-1", step: "photos" });
    if (id) search.set("unitId", id);
    const screen = mount(true, { "next/navigation": {
      useRouter: () => ({ replace: (path) => destinations.push(path) }), useSearchParams: () => search,
    } });
    const setup = modal(screen.render("NewSpace"));
    assert.equal(setup.props.open, true);
    assert.equal(setup.props.mode, id ? "edit" : "create");
    assert.equal(setup.props.unitId, id ?? undefined);
    assert.equal(setup.props.startAt, id ? "photos" : undefined);
    setup.props.onClose();
    assert.equal(destinations.pop(), id ? "/record/space?propertyId=property-1&spaceId=unit-1" : "/record/property?id=property-1");
    setup.props.onFinished({ id: "unit-1" });
    setup.props.onClose();
    assert.ok(destinations.every((path) => path === "/record/space?propertyId=property-1&spaceId=unit-1"));
  }
});

test("resuming never shows a creation form while the saved Unit is loading or has failed to load", () => {
  const source = readFileSync(new URL("../components/property/UnitWizard.tsx", import.meta.url), "utf8");
  const jsx = (type, props) => ({ type, props });
  for (const saved of [null, { ...unit(), id: "another-unit" }, { ...unit(), property: { id: "another-property" } }, unit()]) {
    let cursor = 0;
    const values = [{ id: "property-1" }, saved, "details", false, false, false, "Could not reopen this Unit."];
    const exports = compile(source, {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: { useEffect() {}, useCallback: (fn) => fn, useRef: (current) => ({ current }), useState: () => [values[cursor++], () => {}] },
      "@/components/Notice": { Notice: "Notice" },
      "@/components/creation/WizardShell": { WizardShell: "WizardShell" },
      "@/components/creation/useWizardDraft": { useWizardDraft: () => ({ commits: {} }) },
    });
    const view = exports.UnitWizard({ mode: "edit", propertyId: "property-1", unitId: "unit-1" });
    if (saved?.id === "unit-1" && saved.property.id === "property-1") {
      assert.equal(view.type, "WizardShell");
    } else {
      assert.equal(view.props.className, "cw-loading");
      assert.equal(view.props.children.type, "Notice");
      assert.equal(view.props.children.props.title, "Could not reopen this Unit.");
    }
  }
});

const wizardSource = readFileSync(new URL("../components/property/UnitWizard.tsx", import.meta.url), "utf8");
const jsx = (type, props) => ({ type, props });
const property = { id: "property-1", property_type: "residential" };
const options = [{ value: "apartment", label: "Apartment", asks: { bedrooms: true, bathrooms: "count", floor: true } }];
const fields = {
  label: "Garden Flat", bedrooms: 0, bathrooms: 0, floor_level: null,
  wing: "West", entrance_note: "Side door", description: "Quiet",
};
const savedUnit = { ...unit(), ...fields, space_type: "apartment" };

function details(initialUnit) {
  const values = [];
  const writes = [];
  const saved = [];
  let cursor;
  let error;
  const commitRef = { current: null };
  const write = (method) => async (id, payload) => {
    writes.push({ method, id, payload: JSON.parse(JSON.stringify(payload)) });
    if (error) throw error;
    return savedUnit;
  };
  const { DetailsStep } = compile(wizardSource + "\nexports.DetailsStep = DetailsStep;", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useEffect: (callback, dependencies) => { if (!dependencies) callback(); },
      useState(initial) {
        const index = cursor++;
        if (!(index in values)) values[index] = initial;
        return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
      },
    },
    "@/components/Field": { Field: "Field" },
    "@/components/creation/StepActions": { CountStepper: "CountStepper" },
    "@/components/creation/WizardShell": { ChoiceTiles: "ChoiceTiles", FormSection: "FormSection" },
    "@/lib/console": { createUnit: write("POST"), updateUnit: write("PATCH") },
  });
  return {
    render() {
      cursor = 0;
      return DetailsStep({ property, unit: initialUnit, options, commitRef, onSaved: (next) => saved.push(next) });
    },
    submit: () => commitRef.current(),
    fail: (cause) => { error = cause; },
    writes,
    saved,
  };
}

const control = (tree, label) => find(tree, (node) => node.props?.label === label)?.props;

test("create and edit render the same fields and prefill zero counts and an unset floor", () => {
  const create = details(null).render();
  const edit = details(savedUnit).render();
  const fieldsOf = (tree) => nodes(tree).filter((node) => node.props?.label).map((node) => node.props.label);
  assert.deepEqual(fieldsOf(create), fieldsOf(edit));
  assert.equal(control(create, "Name").value, "");
  assert.equal(control(create, "Bedrooms").value, 1);
  assert.equal(control(create, "Floor").value, 0);
  assert.equal(control(edit, "What is being let?").value, "apartment");
  assert.equal(control(edit, "What is being let?").disabled, true);
  assert.equal(control(edit, "Name").value, fields.label);
  assert.equal(control(edit, "Block or wing").value, fields.wing);
  assert.equal(control(edit, "Bedrooms").value, 0);
  assert.equal(control(edit, "Bathrooms").value, 0);
  assert.equal(control(edit, "Floor").value, null);
  assert.equal(control(edit, "How to find its door").value, fields.entrance_note);
  assert.equal(control(edit, "Description").value, fields.description);
});

test("both modes validate on submit, keep edits after an API error, and send the expected payload on retry", async () => {
  for (const initial of [null, savedUnit]) {
    const form = details(initial);
    control(form.render(), "Name").onChange({ target: { value: "  " } });
    form.render();
    assert.equal(await form.submit(), false);
    assert.match(control(form.render(), "Name").error, /Give it a name/);
    assert.deepEqual(form.writes, []);
    control(form.render(), "Name").onChange({ target: { value: "  New Name  " } });
    form.render();
    const rejection = new Error("Save rejected");
    form.fail(rejection);
    await assert.rejects(form.submit(), (error) => error === rejection);
    assert.deepEqual(form.saved, []);
    assert.equal(control(form.render(), "Name").value, "  New Name  ");
    form.fail(null);
    assert.equal(await form.submit(), true);
    assert.deepEqual(form.writes.at(-1), initial ? {
      method: "PATCH", id: initial.id, payload: { ...fields, label: "New Name" },
    } : {
      method: "POST", id: property.id, payload: {
        label: "New Name", description: "", bedrooms: 1, bathrooms: 1, floor_level: 0,
        wing: "", entrance_note: "", space_type: "apartment",
      },
    });
    assert.deepEqual(form.saved, [savedUnit]);
  }
});

test("closing the shared modal unmounts the form, and a new form starts from fresh initial values", () => {
  const source = readFileSync(new URL("../components/property/UnitWizardModal.tsx", import.meta.url), "utf8");
  const { UnitWizardModal } = compile(source, {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/dynamic": { default: () => "LazyWizard" },
  });
  for (const initial of [null, savedUnit]) {
    const props = initial ? { mode: "edit", unitId: initial.id } : { mode: "create" };
    const form = details(initial);
    assert.ok(UnitWizardModal({ ...props, open: true }));
    control(form.render(), "Name").onChange({ target: { value: "Unsaved" } });
    assert.equal(control(form.render(), "Name").value, "Unsaved");
    assert.equal(UnitWizardModal({ ...props, open: false }), null);
    assert.ok(UnitWizardModal({ ...props, open: true }));
    assert.equal(control(details(initial).render(), "Name").value, initial?.label ?? "");
  }
});

test("details starts the field rules request before the Property or Unit response resolves", () => {
  for (const mode of ["create", "edit"]) {
    const calls = [];
    const pending = (name) => {
      calls.push(name);
      return new Promise(() => {});
    };
    const { UnitWizard } = compile(wizardSource, {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: {
        useEffect: (callback) => callback(),
        useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
        useCallback: (callback) => callback,
      },
      "@/lib/console": { getProperty: () => pending("property"), getUnit: () => pending("unit") },
      "@/lib/propertyTypes": { loadPropertyTypes: () => pending("rules") },
      "@/components/creation/useWizardDraft": { useWizardDraft: () => ({}) },
    });
    const view = UnitWizard({ mode, propertyId: property.id, unitId: mode === "edit" ? savedUnit.id : undefined });
    assert.equal(view.props.className, "cw-loading");
    assert.deepEqual(calls, mode === "edit" ? ["property", "unit", "rules"] : ["property", "rules"]);
  }
});
