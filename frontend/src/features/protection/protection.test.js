import { describe, expect, it, vi } from "vitest";
import { canProtect, isProtectedError, isProtectedItem, keptMessage, notDeletedMessage, protectedReason, protectedSelectionReason, unprotectWith } from "./protection";

describe("protect from deletion", () => {
    it("an item is protected itself or by the folder it's in", () => {
        expect(isProtectedItem({ name: "a.pdf", protected: true, protected_by: null })).toBe(true);
        expect(isProtectedItem({ name: "a.pdf", protected: false, protected_by: "Taxes" })).toBe(true);
        expect(isProtectedItem({ name: "a.pdf", protected: false, protected_by: null })).toBe(false);
        expect(isProtectedItem(null)).toBe(false);
    });

    it("says why an item can't be deleted", () => {
        expect(protectedReason({ name: "passport.pdf", protected: true })).toBe("“passport.pdf” is protected. Remove protection first.");
        expect(protectedReason({ name: "2024.pdf", protected: false, protected_by: "Taxes" }))
            .toBe("“2024.pdf” is inside the protected folder “Taxes”. Remove the folder's protection first.");
    });

    it("says why a selection can't be deleted", () => {
        const plain = { name: "a.jpg" };
        const own = { name: "b.pdf", protected: true };
        const inside = { name: "c.pdf", protected_by: "Taxes" };
        expect(protectedSelectionReason([plain])).toBeNull();
        expect(protectedSelectionReason([])).toBeNull();
        expect(protectedSelectionReason([own])).toBe("“b.pdf” is protected. Remove protection first.");
        expect(protectedSelectionReason([plain, own])).toBe("1 protected item — remove protection first");
        expect(protectedSelectionReason([plain, own, inside])).toBe("2 protected items — remove protection first");
    });

    it("counts in messages", () => {
        expect(notDeletedMessage(1)).toBe("1 protected item not deleted");
        expect(notDeletedMessage(3)).toBe("3 protected items not deleted");
        expect(keptMessage(2)).toBe("2 protected items kept");
    });

    it("recognises the server's refusal", () => {
        expect(isProtectedError({ status: 423 })).toBe(true);
        expect(isProtectedError({ status: 404 })).toBe(false);
        expect(isProtectedError(null)).toBe(false);
    });

    it("removing protection spends the pass on that one item, once", async () => {
        const client = {
            unlockProtection: vi.fn(async () => ({ unlock_token: "tok-1", expires_in: 120 })),
            setProtected: vi.fn(async () => ({ protected: false })),
        };
        await unprotectWith(client, "f5", { password: "right-pass" });
        expect(client.unlockProtection).toHaveBeenCalledWith({ password: "right-pass", fileId: "f5" });
        expect(client.setProtected).toHaveBeenCalledTimes(1);
        expect(client.setProtected).toHaveBeenCalledWith("f5", false, "tok-1");
    });

    it("a wrong password removes nothing", async () => {
        const client = {
            unlockProtection: vi.fn(async () => { throw Object.assign(new Error("Wrong password."), { status: 400 }); }),
            setProtected: vi.fn(),
        };
        await expect(unprotectWith(client, "f5", { code: "000000" })).rejects.toThrow("Wrong password.");
        expect(client.unlockProtection).toHaveBeenCalledWith({ code: "000000", fileId: "f5" });
        expect(client.setProtected).not.toHaveBeenCalled();
    });

    it("only TeleStore items outside Trash and the Vault can be protected", () => {
        expect(canProtect({ id: "f1", name: "a.pdf" })).toBe(true);
        expect(canProtect({ id: "f1", is_cloud: true })).toBe(false);
        expect(canProtect({ id: "f1", trashed: true })).toBe(false);
        expect(canProtect({ id: "f1", is_vault: true })).toBe(false);
        expect(canProtect({ id: "v", is_virtual: true })).toBe(false);
        expect(canProtect(null)).toBe(false);
    });
});
