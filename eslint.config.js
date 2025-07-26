// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginImportX from "eslint-plugin-import-x";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import { createNextImportResolver } from "eslint-import-resolver-next";

export default tseslint.config({ ignores: ["dist"] }, eslint.configs.recommended, {
  extends: [
    tseslint.configs.recommendedTypeChecked,
    // tseslint.configs.stylisticTypeChecked,
    eslintPluginImportX.flatConfigs.recommended,
    eslintPluginImportX.flatConfigs.typescript,
    eslintPluginPrettierRecommended,
  ],
  files: ["**/*.ts"],
  languageOptions: {
    ecmaVersion: 2022,
    parser: tseslint.parser,
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  plugins: {
    "@typescript-eslint": tseslint.plugin,
  },
  rules: {
    "no-empty": ["error", { allowEmptyCatch: true }],
    // "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/no-empty-function": [
      "error",
      { allow: ["private-constructors", "overrideMethods"] },
    ],
    // "@typescript-eslint/no-floating-promises": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    "@typescript-eslint/restrict-template-expressions": ["off"],
    
    "import-x/no-unresolved": "error",
    "import-x/order": [
      "error",
      {
        "newlines-between": "always",
        alphabetize: {
          order: "asc",
          caseInsensitive: true,
        },
      },
    ],
  },
  settings: {
    "import-x/resolver-next": [createNextImportResolver({ packages: { pnpmWorkspace: true } })],
  },
});
