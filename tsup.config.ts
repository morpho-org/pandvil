import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server/server.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["child_process"],
});
