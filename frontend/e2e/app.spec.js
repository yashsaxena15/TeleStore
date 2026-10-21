// End-to-end checks of the main screens against the mock backend (see e2e/mock-server.mjs).
import { test, expect } from "@playwright/test";

const row = (page, name) => page.getByRole("row", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`) });

const mutations = async (request) => (await (await request.get("/__requests")).json());

test.beforeEach(async ({ request, page }) => {
    await request.delete("/__requests");
    await page.addInitScript(() => {
        try {
            // Start each test in a clean state: Home, dark theme, details pane closed
            if (!sessionStorage.getItem("e2e-init")) {
                localStorage.clear();
                sessionStorage.setItem("e2e-init", "1");
            }
        }
        catch {
            // storage blocked
        }
    });
});

test.describe("navigation", () => {
    test("sidebar opens every page and the address follows", async ({ page }) => {
        await page.goto("/");
        await expect(row(page, "Movies")).toBeVisible();
        const sidebar = page.getByRole("complementary").first();
        await sidebar.getByRole("button", { name: "Transfers" }).click();
        await expect(page).toHaveURL(/\/transfers$/);
        await expect(page.getByRole("heading", { level: 1, name: "Transfers" })).toBeVisible();
        await sidebar.getByRole("button", { name: "Storage" }).click();
        await expect(page).toHaveURL(/\/storage$/);
        await expect(page.getByRole("heading", { level: 1, name: "Storage" })).toBeVisible();
        await sidebar.getByRole("button", { name: "Home" }).click();
        await expect(page).toHaveURL(/\/$/);
        await expect(row(page, "Movies")).toBeVisible();
    });

    test("opening a page address directly never creates a fake folder", async ({ page }) => {
        await page.goto("/storage");
        await expect(page.getByRole("heading", { level: 1, name: "Storage" })).toBeVisible();
        await page.getByRole("complementary").first().getByRole("button", { name: "Home" }).click();
        const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
        await expect(crumbs).toContainText("Home");
        await expect(crumbs).not.toContainText("storage");
    });

    test("browser back and forward move between folders and pages", async ({ page }) => {
        await page.goto("/");
        await row(page, "Movies").dblclick();
        await expect(row(page, "Arrival.2016.1080p.mkv")).toBeVisible();
        await page.getByRole("complementary").first().getByRole("button", { name: "Storage" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Storage" })).toBeVisible();
        await page.goBack();
        await expect(row(page, "Arrival.2016.1080p.mkv")).toBeVisible();
        await page.goBack();
        await expect(row(page, "Movies")).toBeVisible();
        await page.goForward();
        await expect(row(page, "Arrival.2016.1080p.mkv")).toBeVisible();
    });

    test("settings tabs live in the address and old addresses still work", async ({ page }) => {
        await page.goto("/profile");
        const sections = page.getByRole("navigation", { name: "Settings sections" });
        await expect(sections.getByRole("button", { name: "Account" })).toHaveAttribute("aria-current", "page");
        await sections.getByRole("button", { name: "Vault" }).click();
        await expect(page).toHaveURL(/\/settings\?tab=vault$/);
        await expect(page.getByText("Auto-lock", { exact: true })).toBeVisible();
        await page.goto("/users");
        await expect(sections.getByRole("button", { name: "Users" })).toHaveAttribute("aria-current", "page");
    });
});

test.describe("file explorer", () => {
    test("selection bar, details pane and Move to…", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Select Q3-report.pdf" }).click();
        const bar = page.getByRole("toolbar", { name: "1 selected" });
        await expect(bar).toContainText("1 selected");
        await page.keyboard.press("i");
        await expect(page.getByRole("complementary", { name: "Details" })).toContainText("Q3-report.pdf");
        await page.keyboard.press("i");
        await bar.getByRole("button", { name: /Move to/ }).click();
        await page.getByRole("button", { name: "Open Movies" }).click();
        await page.getByRole("button", { name: /^(Move here|Select)/ }).last().click();
        await expect.poll(async () => (await mutations(request)).some((r) => r.path === "/files/move" && r.body.includes('"target_path":"/Home/Movies"'))).toBe(true);
    });

    test("a folder with 1,500 files shows them all when the page size is All", async ({ page }) => {
        await page.goto("/");
        await row(page, "Documents").dblclick();
        await expect(row(page, "scan-0001.pdf")).toBeVisible();
        await page.getByRole("combobox").last().click();
        await page.getByRole("option", { name: "All" }).click();
        // Only the visible part of the list is in the page, yet the last file can be reached
        const rendered = await page.getByRole("row", { name: /^scan-/ }).count();
        expect(rendered).toBeLessThan(400);
        await page.getByRole("grid").first().focus();
        await page.keyboard.press("End");
        await expect(row(page, "scan-1500.pdf")).toBeVisible();
    });
});

test.describe("item actions", () => {
    const sent = async (request, path) => (await mutations(request)).filter((r) => r.path === path);

    test("star, rename and move to trash", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Star Q3-report.pdf" }).click();
        await expect.poll(async () => (await sent(request, "/files/star")).length).toBe(1);

        await page.getByRole("button", { name: "More actions for project-src.zip" }).first().click();
        await page.getByRole("menuitem", { name: /Rename/ }).click();
        const input = page.locator("input:focus");
        await input.fill("project-src-2.zip");
        await input.press("Enter");
        await expect.poll(async () => (await mutations(request)).some((r) => /rename/.test(r.path) && r.body.includes("project-src-2.zip"))).toBe(true);

        await page.getByRole("button", { name: "Select team-offsite.jpg" }).click();
        await page.getByRole("toolbar", { name: /selected$/ }).getByRole("button", { name: /Delete/ }).click();
        const confirm = page.getByRole("alertdialog");
        if (await confirm.isVisible().catch(() => false))
            await confirm.getByRole("button", { name: /Delete|Move to Trash|Trash/ }).last().click();
        await expect.poll(async () => (await sent(request, "/files/trash")).some((r) => r.body.includes('"f8"'))).toBe(true);
    });

    test("new folder from the New menu", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "New", exact: true }).first().click();
        await page.getByRole("menuitem", { name: /New folder/ }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("textbox").fill("Taxes 2026");
        await dialog.getByRole("button", { name: /Create/ }).click();
        await expect.poll(async () => (await mutations(request)).some((r) => r.path.startsWith("/folders/create") && r.body.includes("Taxes 2026"))).toBe(true);
    });

    test("copy in one folder, paste in another", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Select Q3-report.pdf" }).click();
        await page.getByRole("toolbar", { name: "1 selected" }).getByRole("button", { name: /^Copy/ }).click();
        await row(page, "Movies").dblclick();
        await expect(row(page, "Arrival.2016.1080p.mkv")).toBeVisible();
        // Right-click empty space below the files
        await page.mouse.click(900, 600, { button: "right" });
        await page.getByRole("menuitem", { name: /Paste/ }).click();
        await expect.poll(async () => (await mutations(request)).some((r) => /copy|paste/.test(r.path) && r.body.includes("/Home/Movies"))).toBe(true);
    });
});

test.describe("player", () => {
    test("video starts on its own and stays paused when audio takes over", async ({ page }) => {
        await page.goto("/");
        await row(page, "Movies").dblclick();
        await row(page, "Arrival.2016.1080p.mkv").dblclick();
        const video = page.locator("video");
        await expect.poll(() => video.evaluate((v) => !v.paused && v.currentTime > 0)).toBe(true);
        await page.evaluate(() => window.dispatchEvent(new Event("telestore:pause-video")));
        await video.evaluate((v) => v.dispatchEvent(new Event("canplay")));
        await page.waitForTimeout(600);
        expect(await video.evaluate((v) => v.paused)).toBe(true);
        // The folder's other video is next in the playlist
        await page.getByRole("button", { name: "Next video" }).click();
        await expect(page.getByText("Blade.Runner.2049.mkv").first()).toBeVisible();
    });
});

test.describe("security messages", () => {
    test("a locked-out vault shows the wait time", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("complementary").first().getByRole("button", { name: "Private Vault" }).click();
        for (const d of ["1", "2", "3", "4"])
            await page.getByRole("button", { name: d, exact: true }).click();
        await expect(page.getByText(/Try again in 1 minute/)).toBeVisible();
    });
});

test.describe("storage", () => {
    test("totals, usage table and largest files", async ({ page }) => {
        await page.goto("/storage");
        await expect(page.getByText("1843")).toBeVisible();
        await expect(page.getByRole("cell", { name: "Videos" })).toBeVisible();
        await expect(page.getByText("Dune.Part.Two.2024.2160p.HDR.mkv")).toBeVisible();
    });
});

test.describe("phone @phone", () => {
    test("bottom tabs and settings sub-menu fit the screen", async ({ page }) => {
        await page.goto("/");
        await expect(row(page, "Movies")).toBeVisible();
        await page.getByRole("button", { name: "Transfers" }).last().click();
        await expect(page).toHaveURL(/\/transfers$/);
        await page.goto("/settings?tab=vault");
        await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Vault" })).toBeInViewport();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
