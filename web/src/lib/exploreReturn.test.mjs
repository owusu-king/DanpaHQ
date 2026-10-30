import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URLSearchParams, require: (name) => imports[name] ?? {} });
  return exports;
}
const navigation = compile("./exploreReturn.ts");

test("sale links round-trip All places, intentional Buy filters, and map search URLs", () => {
  for (const origin of ["/rentals", "/rentals?view=map", "/rentals?q=Accra&bedrooms=2", "/rentals?mode=buy&q=Kumasi&kind=land", "/rentals?view=map&bbox=-1,5,0,6"]) {
    const link = new URL(navigation.saleDetailPath("sale-1", origin), "https://example.test");
    assert.equal(link.pathname, "/record/sale");
    assert.equal(link.searchParams.get("id"), "sale-1");
    assert.equal(navigation.exploreReturnPath(link.searchParams.get("returnTo")), origin);
  }
});

test("direct links default to All places and untrusted destinations cannot change the return route", () => {
  for (const origin of [null, undefined, "", "https://evil.example/rentals", "//evil.example/rentals", "javascript:alert(1)", "/rentals-elsewhere", "/record/property?id=1"]) {
    assert.equal(navigation.exploreReturnPath(origin), "/rentals");
  }
});

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}
const jsx = (type, props) => ({ type, props });
const sale = { id: "sale-1", headline: "Land for sale", kind: "land", kind_label: "Land", gallery: [], description: "", amenities: [] };

test("every sale card link carries the Explore search it came from", () => {
  const { SaleCard } = compile("../components/sales/SaleCard.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx }, "next/link": { default: "Link" },
    "@/lib/exploreReturn": navigation, "@/lib/sales": { saleFacts: () => [] },
  });
  const origin = "/rentals?view=map&q=Accra";
  const links = nodes(SaleCard({ sale, returnTo: origin })).filter((node) => node.type === "Link");
  assert.equal(links.length, 3);
  assert.ok(links.every((link) => new URL(link.props.href, "https://example.test").searchParams.get("returnTo") === origin));
});

function salePage(origin, unavailable = false) {
  let cursor = 0;
  const values = [unavailable ? null : sale, unavailable ? "Unavailable" : "", false, false, false, null];
  const auth = [];
  const search = new URLSearchParams({ id: sale.id });
  if (origin) search.set("returnTo", origin);
  const { default: SalePage } = compile("../../app/record/sale/page.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useEffect() {}, useState: () => [values[cursor++], () => {}] },
    "next/dynamic": { default: () => "LocationMap" }, "next/link": { default: "Link" },
    "next/navigation": { useRouter: () => ({}), useSearchParams: () => search },
    "@/components/auth/AuthDialog": { useAuthDialog: () => ({ open: (...args) => auth.push(args) }) },
    "@/components/PageTitle": { usePageTitle() {} }, "@/components/Button": { Button: "Button" },
    "@/lib/session": { useSession: () => ({ state: { status: "signed_out" } }) },
    "@/lib/exploreReturn": navigation, "@/lib/sales": { saleFacts: () => [] },
  });
  return { tree: SalePage(), auth };
}

test("loaded and unavailable sale pages return to the original Explore mode without choosing Buy", () => {
  for (const origin of [null, "/rentals?view=map", "/rentals?mode=buy&kind=land"]) {
    for (const unavailable of [false, true]) {
      const { tree } = salePage(origin, unavailable);
      const back = nodes(tree).find((node) => node.props?.className === "listing-back");
      assert.equal(back.props.href, origin ?? "/rentals");
    }
  }
});

test("signing in to enquire retains the same Explore return destination", () => {
  const origin = "/rentals?view=map&q=Accra";
  const { tree, auth } = salePage(origin);
  nodes(tree).find((node) => node.type === "Button" && node.props.children === "Express interest").props.onClick();
  assert.equal(auth[0][0], "sign-in");
  assert.equal(new URL(auth[0][1].next, "https://example.test").searchParams.get("returnTo"), origin);
});
