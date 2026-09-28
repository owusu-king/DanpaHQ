const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["node_modules/**", ".expo/**", "dist/**"],
  },
  {
    // SDK 57's config brings react-hooks 7 and its React Compiler rules. They flag
    // code written before them — chiefly `useRef(new Animated.Value(…)).current`,
    // React Native's own idiom — so they warn until that code is revisited.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);
