import eslint from "@eslint/js";
import vue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".playwright-cli/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "output/**",
      "playwright-report/**",
      "src-tauri/gen/**",
      "src-tauri/target/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      // TypeScript and vue-tsc resolve DOM/type names in SFC scripts; the base
      // JavaScript rule otherwise reports type-only globals as runtime names.
      "no-undef": "off",
      "vue/multi-word-component-names": "off",
      "vue/attributes-order": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/html-indent": "off",
      "vue/html-self-closing": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
    },
  },
  {
    files: ["**/*.test.ts", "e2e/**/*.ts"],
    rules: {
      "vue/one-component-per-file": "off",
      "vue/require-prop-types": "off",
    },
  },
);
