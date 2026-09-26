import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// The two classic hooks rules only. react-hooks 7's "recommended" also turns
// on the React Compiler rules (set-state-in-effect, refs, purity…), which flag
// the fetch-in-useEffect pattern every screen is built on; adopting them is a
// migration of its own, not a lint setting.
export default defineConfig(
  { ignores: ["dist", "coverage"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // French typography puts a no-break space before « : ; ? ! » and inside
      // « », in strings, templates, JSX text and the comments that quote them.
      // What the rule exists for -- an invisible character between two tokens
      // of code -- is still caught.
      "no-irregular-whitespace": ["error", {
        skipStrings: true, skipTemplates: true, skipJSXText: true,
        skipComments: true, skipRegExps: true,
      }],
      // `const { dropped: _unused, ...kept } = value` is how a field is left out.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
);
