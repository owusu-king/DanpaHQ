import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These screens intentionally fetch remote data on mount. Their async
      // loaders update state after awaiting I/O; this rule treats the call
      // site as a synchronous update and reports false positives.
      "react-hooks/set-state-in-effect": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: "Format money with formatMoney() from @/lib/money, not toFixed().",
        },
      ],
    },
  },
  globalIgnores([".next/**", "next-env.d.ts"]),
]);
