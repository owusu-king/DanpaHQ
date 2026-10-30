import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./maps/leafletHtml.ts", import.meta.url), "utf8");
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: module.exports,
  require: (name) => name.includes("leafletRuntime") ? { LEAFLET_CSS: "", LEAFLET_JS: "" } : { safeScriptJSON: JSON.stringify },
});

function documentFor(initialState, size = { x: 375, y: 280 }) {
  const html = module.exports.leafletHTML({ url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "OSM", attributionUrl: "https://www.openstreetmap.org/copyright" }, { lat: 5.6, lng: -0.18, zoom: 12 }, true, initialState);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const markers = [], messages = [], fits = [], invalidations = [];
  const element = () => ({ style: { setProperty() {} }, addEventListener() {} });
  const container = element();
  let resize;
  const map = {
    setView() { return this; }, on() {}, attributionControl: { setPrefix() {} },
    getContainer: () => container, getSize: () => size, getZoom: () => 12,
    containerPointToLatLng: () => ({ lat: 5, lng: -1 }),
    fitBounds: (...args) => fits.push(args), invalidateSize: (options) => invalidations.push(options),
  };
  const window = { ReactNativeWebView: { postMessage: (value) => messages.push(JSON.parse(value)) }, addEventListener: (_name, fn) => { resize = fn; } };
  vm.runInNewContext(script, {
    window, document: { createElement: element, getElementById: () => container },
    L: {
      map: () => map, divIcon: (options) => options,
      tileLayer: () => ({ addTo() { return this; }, on() {} }),
      marker: (position, options) => {
        const marker = { position, options, removed: false, enabled: options.draggable,
          addTo() { return this; }, on() {}, setLatLng(next) { this.position = next; }, setIcon() {}, setZIndexOffset() {},
          remove() { this.removed = true; },
        };
        marker.dragging = { enable: () => { marker.enabled = true; }, disable: () => { marker.enabled = false; } };
        markers.push(marker); return marker;
      },
    },
    setTimeout() {}, requestAnimationFrame: (callback) => callback(),
  });
  return { html, markers, messages, fits, invalidations, update: window.DanpaMap.update, resize: () => resize() };
}

const rental = { key: "listing:1", position: { lat: 5.6, lng: -0.18 }, kind: "price", label: "₵800", accessibilityLabel: "Rental" };
const pin = { latitude: 5.61, longitude: -0.19 };

test("the HTML renders initial markers and a property pin before a native ready response", () => {
  const page = documentFor({ markers: [rental], pin });
  assert.equal(page.markers.length, 2);
  assert.deepEqual(Array.from(page.markers[0].position), [5.6, -0.18]);
  assert.deepEqual(Array.from(page.markers[1].position), [5.61, -0.19]);
  assert.equal(page.markers[1].options.zIndexOffset, 1000);
  assert.ok(page.messages.some((message) => message.type === "ready"));
  assert.doesNotMatch(page.html, /\.danpa-marker[^}]*translate:/);
  assert.match(page.html, /\.pin-face\{[^}]*transform:translate\(-50%,-100%\)/);
});

test("pin updates retain the marker, respect locking, and remove it only when cleared", () => {
  const page = documentFor({ markers: [rental], pin });
  const originalPin = page.markers[1];
  page.update({ markers: [rental], pin: { latitude: 6.7, longitude: -1.62 }, selectable: false });
  assert.equal(page.markers.length, 2);
  assert.equal(originalPin.removed, false);
  assert.equal(originalPin.enabled, false);
  assert.deepEqual(Array.from(originalPin.position), [6.7, -1.62]);
  page.update({ markers: [], pin: null });
  assert.equal(originalPin.removed, true);
  assert.equal(page.markers[0].removed, true);
});

test("a fit waits for nonzero layout and clamps large overlay insets", () => {
  const size = { x: 0, y: 0 };
  const page = documentFor({ markers: [rental], fit: { key: "town", bounds: { west: -1, south: 5, east: 0, north: 6 } }, insets: { top: 500, bottom: 500, left: 0, right: 0 } }, size);
  assert.equal(page.fits.length, 0);
  size.x = 375; size.y = 280;
  page.resize();
  assert.equal(page.fits.length, 1);
  assert.equal(page.invalidations.at(-1).animate, false);
  assert.notEqual(page.invalidations.at(-1).pan, false);
  const padding = page.fits[0][1];
  assert.ok(padding.paddingTopLeft[1] + padding.paddingBottomRight[1] < size.y);
  page.resize();
  assert.equal(page.fits.length, 1);
});

test("native load completion and repeated ready messages replay markers after a WebView reload", () => {
  const viewSource = readFileSync(new URL("./maps/LeafletView.tsx", import.meta.url), "utf8");
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const injected = [];
  vm.runInNewContext(ts.transpileModule(viewSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, URL,
    require: (name) => ({
      react: { useRef: (current) => ({ current }), useState: (initial) => [initial === "" ? "test map document" : initial, () => {}], useEffect() {}, useMemo: (fn) => fn(), useCallback: (fn) => fn },
      "react/jsx-runtime": { jsx, jsxs: jsx }, "react-native": { View: "View", StyleSheet: { absoluteFill: {} } },
      "react-native-webview": { WebView: "WebView" }, "expo-constants": {},
      "@/places": {}, "./bridge": { validPoint: (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng), safeScriptJSON: JSON.stringify, parseMapMessage: JSON.parse },
      "./leafletHtml": { MAP_ORIGIN: "https://danpahq.com/" },
    })[name], process: { env: {} },
  });
  assert.equal(exports.isMapDocumentURL("https://danpahq.com"), true);
  assert.equal(exports.isMapDocumentURL("about:blank"), true);
  for (const url of ["https://danpahq.com/other", "https://other.test/", "https://danpahq.com/?remote=1", "file:///map.html"]) assert.equal(exports.isMapDocumentURL(url), false);
  const tree = exports.LeafletView({ initialView: { lat: 5.6, lng: -0.18, zoom: 12 }, markers: [rental], fit: null, insets: {}, pin, selecting: true, onMove() {}, onMarkerPress() {}, onBackgroundPress() {} });
  const web = tree.props.children;
  web.props.ref.current = { injectJavaScript: (value) => injected.push(value) };
  web.props.onLoadEnd();
  web.props.onMessage({ nativeEvent: { url: "https://danpahq.com", data: '{"type":"ready"}' } });
  web.props.onLoadStart();
  web.props.onLoadEnd();
  assert.equal(injected.length, 3);
  for (const script of injected) { assert.match(script, /listing:1/); assert.match(script, /"latitude":5.61/); }
});
