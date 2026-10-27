// Browser tests: run against the production build served by a mock backend (e2e/mock-server.mjs).
// `npm run build` first, then `npm run test:e2e`.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
    testDir: "./e2e",
    timeout: 30_000,
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        // The site's service worker (offline use) stays out of the way except in the test for it
        serviceWorkers: "block",
    },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, grepInvert: /@phone/ },
        { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
    ],
    webServer: {
        command: `node e2e/mock-server.mjs dist ${PORT}`,
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: !process.env.CI,
    },
});
