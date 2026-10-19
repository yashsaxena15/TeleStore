import { describe, it, expect } from "vitest";
import { settingsTabFromLocation, settingsUrl } from "./settingsTabs";

describe("settings tabs", () => {
    it("maps old page addresses and the tab parameter", () => {
        expect(settingsTabFromLocation("/profile")).toBe("account");
        expect(settingsTabFromLocation("/users")).toBe("users");
        expect(settingsTabFromLocation("/settings", "?tab=vault")).toBe("vault");
        expect(settingsTabFromLocation("/settings", "?tab=nope")).toBe("account");
        expect(settingsTabFromLocation("/settings")).toBe("account");
    });
    it("builds URLs for tabs and old page names", () => {
        expect(settingsUrl("profile")).toBe("/settings?tab=account");
        expect(settingsUrl("users")).toBe("/settings?tab=users");
        expect(settingsUrl("integrations")).toBe("/settings?tab=integrations");
        expect(settingsUrl(undefined)).toBe("/settings");
    });
});
