// Sharing: the Share dialog, Shared with me / by me, and the public link page (/s/:token),
// against the mock backend (see the sharing routes in e2e/mock-server.mjs).
import { test, expect } from "@playwright/test";

const row = (page, name) => page.getByRole("row", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`) });
const mutations = async (request) => (await (await request.get("/__requests")).json());

test.beforeEach(async ({ request, page }) => {
    await request.delete("/__requests");
    await page.addInitScript(() => {
        try {
            if (!sessionStorage.getItem("e2e-init")) {
                localStorage.clear();
                localStorage.setItem("auth_token", "secret-token");
                sessionStorage.setItem("e2e-init", "1");
            }
        }
        catch {
            // storage blocked
        }
    });
});

test.describe("Share dialog", () => {
    test("opens from the file menu, adds a person, turns on the link and copies it", async ({ page, request, context }) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.goto("/");
        await row(page, "Movies").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Share" }).click();
        const dialog = page.getByRole("dialog", { name: "Share “Movies”" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("Only you.")).toBeVisible();

        // Someone without an account: the server's message
        await dialog.getByLabel("Add people").fill("nobody");
        await dialog.getByRole("button", { name: "Add" }).click();
        await expect(page.getByText("No TeleStore account has that username or email.")).toBeVisible();

        await dialog.getByLabel("Add people").fill("family");
        await dialog.getByLabel("Role", { exact: true }).selectOption("editor");
        await dialog.getByRole("button", { name: "Add" }).click();
        await expect(dialog.getByText("Family", { exact: true })).toBeVisible();
        await expect(dialog.getByLabel("Role for Family")).toHaveValue("editor");
        const add = (await mutations(request)).filter((r) => r.path === "/shares/item/f1/members" && r.method === "POST").pop();
        expect(JSON.parse(add.body)).toEqual({ who: "family", role: "editor" });

        // Anyone with the link
        await dialog.getByRole("combobox", { name: "General access" }).selectOption("link");
        await expect(dialog.getByText("Viewers can download")).toBeVisible();
        await expect(dialog.getByLabel("Link")).toHaveValue(/\/s\/tok-f1$/);
        await dialog.getByRole("button", { name: "Copy link" }).click();
        await expect(page.getByText("Link copied")).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/s/tok-f1`);

        // A 7-day expiry and a download limit go to the server
        await dialog.getByLabel("Expires").selectOption("7d");
        await expect.poll(async () => (await mutations(request)).filter((r) => r.path === "/shares/item/f1/link").map((r) => JSON.parse(r.body)).some((b) => b.expires_at)).toBe(true);
        await dialog.getByRole("switch", { name: "Download limit" }).click();
        await expect(dialog.getByText("0 of 10 downloads used")).toBeVisible();

        // Reset asks first
        await dialog.getByRole("button", { name: "Reset link" }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Reset link" }).click();
        await expect(dialog.getByLabel("Link")).toHaveValue(/\/s\/tok-f1-new$/);
    });

    test("Share is not offered for several selected items", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Select Movies" }).click();
        await page.getByRole("button", { name: "Select Music" }).click();
        await row(page, "Music").click({ button: "right" });
        await expect(page.getByRole("menuitem", { name: /Move to Trash/ })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: "Share" })).toHaveCount(0);
    });

    test("shared items carry a marker and open from Shared by me", async ({ page }) => {
        await page.goto("/");
        await expect(row(page, "Hans Zimmer - Dune Suite.flac").getByTestId("shared-mark").first()).toBeAttached();
        await expect(row(page, "Movies").getByTestId("shared-mark")).toHaveCount(0);
        await page.getByRole("complementary").first().getByRole("button", { name: "Shared by me" }).click();
        await expect(page).toHaveURL(/\/shared-by-me$/);
        await expect(page.getByRole("heading", { level: 1, name: "Shared by me" })).toBeVisible();
        await expect(page.getByText("1 person")).toBeVisible();
        await page.getByRole("button", { name: "Share Hans Zimmer - Dune Suite.flac" }).click();
        await expect(page.getByRole("dialog", { name: "Share “Hans Zimmer - Dune Suite.flac”" }).getByText("Family", { exact: true })).toBeVisible();
    });
});

test.describe("Shared with me", () => {
    test("lists shares and browses a shared folder", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("complementary").first().getByRole("button", { name: "Shared with me" }).click();
        await expect(page).toHaveURL(/\/shared-with-me$/);
        const list = page.getByRole("list", { name: "Shared with me" });
        await expect(list.getByText("Goa trip")).toBeVisible();
        await expect(list.getByText(/Shared by Alice/).first()).toBeVisible();
        await expect(list.getByText("Editor")).toBeVisible();
        await expect(list.getByText("Viewer")).toBeVisible();

        await page.getByRole("button", { name: "Open Goa trip" }).click();
        await expect(page).toHaveURL(/share=sh_w1/);
        await expect(page.getByRole("button", { name: "Open beach.jpg" })).toBeVisible();
        // Editors can add things
        await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
        await page.getByRole("button", { name: "New folder" }).click();
        await page.getByLabel("Folder name").fill("Day 2");
        await page.getByRole("button", { name: "Create" }).click();
        await expect.poll(async () => (await mutations(request)).find((r) => r.path === "/shares/sh_w1/folders")?.body).toBe('{"path":"","name":"Day 2"}');

        await page.getByRole("button", { name: "Open Day 1" }).click();
        await expect(page.getByRole("button", { name: "Open sunset.jpg" })).toBeVisible();
        const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
        await expect(crumbs).toContainText("Day 1");
        await crumbs.getByRole("button", { name: "Goa trip" }).click();
        await expect(page.getByRole("button", { name: "Open beach.jpg" })).toBeVisible();

        // Thumbnails come from the share, signed in with the token
        const thumb = page.locator('img[src*="/shares/sh_w1/thumb/s3"]');
        await expect(thumb).toHaveAttribute("src", /token=secret-token/);
    });

    test("the address in the invite email opens Shared with me", async ({ page }) => {
        await page.goto("/shared-with-me");
        await expect(page.getByRole("heading", { level: 1, name: "Shared with me" })).toBeVisible();
    });
});

test.describe("public link page", () => {
    test("a shared folder opens signed out, without sending the sign-in", async ({ page, request }) => {
        await page.goto("/s/goa");
        await expect(page.getByText("Shared by Alice")).toBeVisible();
        await expect(page.getByRole("button", { name: "Download all" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Open beach.jpg" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Download notes.txt" })).toBeVisible();
        await page.getByRole("button", { name: "Open Day 1" }).click();
        await expect(page).toHaveURL(/path=%2FDay\+1|path=%2FDay%201/);
        await expect(page.getByRole("button", { name: "Open sunset.jpg" })).toBeVisible();
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
        const linkCalls = (await mutations(request)).filter((r) => r.path.startsWith("/share-links/"));
        expect(linkCalls.length).toBeGreaterThan(0);
        expect(linkCalls.every((r) => r.auth === null)).toBe(true);
    });

    test("a file link without downloads has no Download button", async ({ page }) => {
        await page.goto("/s/menu");
        await expect(page.getByRole("heading", { name: "menu.pdf" })).toBeVisible();
        await expect(page.getByText("Downloads are off")).toBeVisible();
        await expect(page.getByRole("button", { name: "Download" })).toHaveCount(0);
    });

    test("an expired link and a missing link say so", async ({ page }) => {
        await page.goto("/s/old");
        await expect(page.getByRole("heading", { name: "This link doesn't work anymore" })).toBeVisible();
        await expect(page.getByText("This link has expired.")).toBeVisible();
        await page.goto("/s/nope");
        await expect(page.getByRole("heading", { name: "This link doesn't exist" })).toBeVisible();
    });

    test("@phone the public page fits a phone", async ({ page }) => {
        await page.goto("/s/goa");
        await expect(page.getByRole("button", { name: "Open beach.jpg" })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
