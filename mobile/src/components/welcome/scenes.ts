import type { ImageSourcePropType } from "react-native";

import { theme } from "@/theme";

/**
 * What each stop of the welcome journey looks like.
 *
 * The scenes are illustrations, not shapes drawn in code. An earlier version of
 * this screen hand-authored the street out of `react-native-svg` rectangles and
 * triangles, which produces geometry rather than artwork — and geometry is what
 * it looked like. Premium illustration comes from an illustrator; what belongs
 * here is the system that carries it.
 *
 * **Bundled, never fetched.** These `require`s put the files in the app binary.
 * The point stands from the version before: a first launch on a slow connection
 * is exactly when a downloaded scene would make the product feel broken. The
 * cost moves to install size instead, which is why `assets/welcome/README.md`
 * puts a hard budget on each file.
 *
 * **Two layers, because depth is the difference between them.** The back layer
 * is the scene; the front layer is the nearest few things, on transparency,
 * travelling faster. One layer is fine — the scene simply drifts as a whole.
 *
 * ## Adding the artwork
 *
 * Drop the files into `mobile/assets/welcome/`, then uncomment the matching
 * `source` line below. That is the whole change; the parallax, the transitions
 * and the reduced-motion handling are already waiting for it.
 *
 * `require` is resolved at build time, so a path that does not exist yet is a
 * bundler error rather than a blank screen. That is why these start commented
 * out instead of pointing at files nobody has drawn.
 */

export type SceneLayer = {
  /** Uncomment when the file exists. */
  source?: ImageSourcePropType;
  /** How far this layer travels relative to a swipe. Bigger is nearer. */
  depth: number;
};

export type Scene = {
  /**
   * Shown until the artwork is installed.
   *
   * Deliberately a plain wash rather than a placeholder pretending to be an
   * illustration. A wrong picture is worse than an honest absence.
   */
  wash: readonly [string, string];
  layers: SceneLayer[];
};

/** Dusk over the street: the whole neighbourhood, and the ecosystem. */
const STREET_AT_DUSK: Scene = {
  wash: [theme.color.lagoon["100"], theme.color.harmattan["100"]],
  layers: [
    { depth: 0.28 /* source: require("../../../assets/welcome/scene-1-back.webp") */ },
    { depth: 0.85 /* source: require("../../../assets/welcome/scene-1-fore.webp") */ },
  ],
};

/** Inside one of those homes, warmer and closer: the tenant's side. */
const INSIDE_A_HOME: Scene = {
  wash: [theme.color.harmattan["100"], theme.color.field["100"]],
  layers: [
    { depth: 0.28 /* source: require("../../../assets/welcome/scene-2-back.webp") */ },
    { depth: 0.85 /* source: require("../../../assets/welcome/scene-2-fore.webp") */ },
  ],
};

/** Pulled back over the same street, held as a portfolio: the provider's side. */
const THE_STREET_HELD: Scene = {
  wash: [theme.color.kola["50"], theme.color.field["100"]],
  layers: [
    { depth: 0.28 /* source: require("../../../assets/welcome/scene-3-back.webp") */ },
    { depth: 0.85 /* source: require("../../../assets/welcome/scene-3-fore.webp") */ },
  ],
};

/**
 * The choice, which has no illustration behind it.
 *
 * The cards are the subject of that stop. A scene under them would be competing
 * with the only decision the journey asks anybody to make.
 */
const THE_CHOICE: Scene = {
  wash: [theme.color.field["100"], theme.color.field["50"]],
  layers: [],
};

export const SCENE_ART: Scene[] = [
  STREET_AT_DUSK,
  INSIDE_A_HOME,
  THE_STREET_HELD,
  THE_CHOICE,
];

/**
 * Native asset modules loaded before the pager appears.
 *
 * A bundled `require` is a number on iOS and Android. Keeping this derived from
 * the manifest means installing an illustration automatically adds it to the
 * preload without creating a second asset list that can drift.
 */
export const WELCOME_ASSET_MODULES = SCENE_ART.flatMap((scene) =>
  scene.layers
    .map((layer) => layer.source)
    .filter((source): source is number => typeof source === "number"),
);

/**
 * The scene sign-in shows a band of.
 *
 * Named rather than reached by index so the crest can use it without the type
 * system having to be told an array has a first element.
 */
export const OPENING_SCENE = STREET_AT_DUSK;
