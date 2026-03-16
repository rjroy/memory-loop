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
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js", "**/*.mjs"],
  },
  // The Agent SDK's .d.ts imports types via .mjs specifiers that eslint's type
  // resolver can't follow (tsc handles them via skipLibCheck). These files
  // iterate AsyncGenerator<SDKMessage> from the SDK, so every property access
  // on yielded events triggers false positives.
  // See: .lore/bugs/agent-sdk-mjs-type-declarations.md
  {
    files: [
      "daemon/src/streaming/session-streamer.ts",
      "daemon/src/streaming/event-translator.ts",
      "daemon/src/session-manager.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  }
);
