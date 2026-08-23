import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    // dsh-float-window ships TypeScript source; files resolved from inside
    // node_modules do not inherit this repo's tsconfig jsx setting, so pin
    // the automatic JSX runtime explicitly ("React is not defined" otherwise).
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
  },
});
