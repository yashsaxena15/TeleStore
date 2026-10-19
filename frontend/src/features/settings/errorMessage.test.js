import { describe, it, expect } from "vitest";
import { errorMessage } from "./errorMessage";

describe("errorMessage", () => {
    it("reads FastAPI detail bodies and plain messages", () => {
        expect(errorMessage(new Error('{"detail":"Current password is incorrect"}'))).toBe("Current password is incorrect");
        expect(errorMessage(new Error("Incorrect vault PIN."))).toBe("Incorrect vault PIN.");
        expect(errorMessage(new Error(""), "Fallback")).toBe("Fallback");
    });
});
