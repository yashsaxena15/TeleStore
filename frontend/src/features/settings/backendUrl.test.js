import { describe, it, expect } from "vitest";
import { healthUrl, isValidBackendUrl } from "./backendUrl";

describe("backend URL helpers", () => {
    it("accepts http(s) URLs and the same-origin shortcut", () => {
        expect(isValidBackendUrl("https://files.example.com")).toBe(true);
        expect(isValidBackendUrl("http://localhost:8148")).toBe(true);
        expect(isValidBackendUrl("/")).toBe(true);
        expect(isValidBackendUrl("")).toBe(false);
        expect(isValidBackendUrl("files.example.com")).toBe(false);
        expect(isValidBackendUrl("ftp://files.example.com")).toBe(false);
    });
    it("builds the health check URL", () => {
        expect(healthUrl("https://x.dev")).toBe("https://x.dev/api/health");
        expect(healthUrl("https://x.dev/")).toBe("https://x.dev/api/health");
        expect(healthUrl("https://x.dev/api")).toBe("https://x.dev/api/health");
    });
});
