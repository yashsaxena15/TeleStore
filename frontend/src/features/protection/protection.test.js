import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { cachedUnlockToken, canProtect, createProtectionGuard, forgetUnlockToken, isProtectionCancelled, rememberUnlockToken, withUnlock } from "./protection";

vi.mock("@/lib/api", () => ({
    ApiError: class extends Error {
        constructor(message, status) {
            super(message);
            this.status = status;
        }
    },
}));

const locked = () => new ApiError("“Taxes” is protected. Confirm with your password to delete it.", 423);

describe("protect from deletion", () => {
    afterEach(() => forgetUnlockToken());

    it("keeps the unlock token until just before it expires", () => {
        rememberUnlockToken("tok", 300, 1_000);
        expect(cachedUnlockToken(1_000)).toBe("tok");
        expect(cachedUnlockToken(1_000 + 285_000)).toBe("tok");
        expect(cachedUnlockToken(1_000 + 295_000)).toBeNull();
        expect(cachedUnlockToken(1_000)).toBeNull();
    });

    it("asks once on 423 and retries with the token", async () => {
        const confirm = vi.fn(async (reason) => {
            expect(reason).toMatch(/is protected/);
            rememberUnlockToken("tok-1", 300);
            return "tok-1";
        });
        const run = createProtectionGuard({ confirm });
        const calls = [];
        const action = (id) => async (token) => {
            calls.push([id, token]);
            if (id !== "plain" && token !== "tok-1") throw locked();
            return id;
        };
        expect(await run(action("a"))).toBe("a");
        expect(await run(action("b"))).toBe("b");
        expect(await run(action("plain"))).toBe("plain");
        expect(confirm).toHaveBeenCalledTimes(1);
        // The first request goes without a token; later ones reuse the confirmed one
        expect(calls).toEqual([["a", undefined], ["a", "tok-1"], ["b", "tok-1"], ["plain", "tok-1"]]);
    });

    it("stops asking after the user cancels", async () => {
        const confirm = vi.fn(async () => null);
        const run = createProtectionGuard({ confirm });
        const action = async () => { throw locked(); };
        await expect(run(action)).rejects.toSatisfy(isProtectionCancelled);
        await expect(run(action)).rejects.toSatisfy(isProtectionCancelled);
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it("passes other errors through", async () => {
        const run = createProtectionGuard({ confirm: vi.fn() });
        await expect(run(async () => { throw new ApiError("Not found", 404); })).rejects.toThrow("Not found");
    });

    it("asks first when removing protection", async () => {
        const confirm = vi.fn(async () => "tok-2");
        const action = vi.fn(async (token) => token);
        expect(await withUnlock("Confirm", action, { confirm })).toBe("tok-2");
        expect(confirm).toHaveBeenCalledWith("Confirm");
        await expect(withUnlock("Confirm", action, { confirm: async () => null })).rejects.toSatisfy(isProtectionCancelled);
    });

    it("only TeleStore items outside Trash can be protected", () => {
        expect(canProtect({ id: "f1", name: "a.pdf" })).toBe(true);
        expect(canProtect({ id: "f1", is_cloud: true })).toBe(false);
        expect(canProtect({ id: "f1", trashed: true })).toBe(false);
        expect(canProtect({ id: "v", is_virtual: true })).toBe(false);
        expect(canProtect(null)).toBe(false);
    });
});
