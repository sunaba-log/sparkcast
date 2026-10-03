import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ROOM_SECRET: "test-room-secret",
          SERVICE_SECRET: "test-service-secret",
          SFU_APP_ID: "test-app",
          SFU_APP_TOKEN: "test-app-token",
          ALLOWED_ORIGINS: "http://localhost:3000",
          REALTIME_API_BASE_URL: "https://sfu.test/v1",
        },
      },
    }),
  ],
});
