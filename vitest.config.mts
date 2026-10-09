import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    // Unit tests never reach the network; tests that exercise the Treasury client inject fetch and re-enable it.
    env: { CALDUN_DISABLE_TREASURY: "1" },
  },
});
