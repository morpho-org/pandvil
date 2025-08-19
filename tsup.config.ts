import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/fixtures/playwright.ts",
    "src/fixtures/vitest.ts",
    "src/server/server.ts",
    "src/bin/cli.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["child_process"],
});
