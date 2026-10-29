import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", action: "src/action.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  noExternal: [/.*/],
  clean: true,
  splitting: false,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
