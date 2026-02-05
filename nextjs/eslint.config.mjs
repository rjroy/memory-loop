import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: [
      ".next/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/*.js",
      "**/*.mjs",
      "next-env.d.ts",
    ],
  },
  // Disable type-checked rules in test files (bun:test can't be resolved by projectService)
  {
    files: [
      "**/__tests__/**/*.ts",
      "**/__tests__/**/*.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  // instrumentation.ts uses require() with variable paths to prevent webpack
  // from following the import chain into cron's child_process dependency
  {
    files: ["instrumentation.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
