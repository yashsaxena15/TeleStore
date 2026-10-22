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

test.describe("users and connection", () => {
    test("owner turns a user off and uploads off, and adds a user", async ({ page, request }) => {
        await page.goto("/settings?tab=users");
        await expect(page.getByText("Needs Telegram")).toBeVisible();
        // Linked by Telegram ID without a username still reads as connected
        await expect(page.getByRole("row", { name: /admin/ })).toContainText("Connected");
        await expect(page.getByRole("row", { name: /family/ })).toContainText("Not connected");
        // The owner's own switches are locked
        await expect(page.getByRole("switch", { name: "admin is active" })).toBeDisabled();
        await page.getByRole("switch", { name: "family is active" }).click();
        await page.getByRole("switch", { name: "family can upload" }).click();
        // The two requests can arrive in either order
        await expect.poll(async () => (await mutations(request)).filter((r) => r.path === "/user/u2").map((r) => r.body).sort()).toEqual(['{"active":false}', '{"can_upload":false}']);

        await page.getByRole("button", { name: "Add user" }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Username").fill("newbie");
        await dialog.getByLabel("Email").fill("newbie@example.com");
        await dialog.getByLabel("Password").fill("secret123");
        await dialog.getByRole("switch").click();
        await dialog.getByRole("button", { name: "Add user" }).click();
        await expect(page.getByText("newbie", { exact: true })).toBeVisible();
        const add = (await mutations(request)).find((r) => r.path === "/user" && r.method === "POST");
        expect(JSON.parse(add.body)).toMatchObject({ username: "newbie", can_upload: false });
    });

    test("connection page in a browser shows only the index chat", async ({ page }) => {
        await page.goto("/settings?tab=connection");
        await expect(page.getByText("Index chat", { exact: true })).toBeVisible();
        await expect(page.getByText("Backend server URL")).toHaveCount(0);
        await expect(page.getByLabel("Chat ID")).toHaveValue("-1004314578828");
        // An empty chat ID can't be saved (uploads would stop working)
        await page.getByLabel("Chat ID").fill("");
        await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    });
});

test.describe("import from Instagram", () => {
    const openDialog = async (page) => {
        await page.goto("/");
        await page.getByRole("button", { name: "New", exact: true }).first().click();
        await page.getByRole("menuitem", { name: /Import from Instagram/ }).click();
        const dialog = page.getByRole("dialog", { name: "Import from Instagram" });
        await expect(dialog).toBeVisible();
        return dialog;
    };
    const importBody = async (request) => JSON.parse((await mutations(request)).find((r) => r.path === "/transfers/remote/instagram").body);

    test("a carousel goes to the open Home folder", async ({ page, request }) => {
        const dialog = await openDialog(page);
        await expect(dialog.getByRole("button", { name: /^Import/ })).toBeDisabled();
        await dialog.getByLabel("Instagram link").fill("https://www.instagram.com/p/ABCdef12345/?igsh=x");
        await expect(dialog.getByLabel("Post preview")).toContainText("@nasa");
        await expect(dialog.getByLabel("Post preview")).toContainText("Carousel · 2 items");
        await dialog.getByRole("button", { name: "Import 2 items" }).click();
        await expect(page.getByText("Importing 2 items from @nasa.")).toBeVisible();
        expect(await importBody(request)).toEqual({ url: "https://www.instagram.com/p/ABCdef12345/?igsh=x", destination: { kind: "home", path: "/Home" } });
    });

    test("a Google Drive folder can be picked", async ({ page, request }) => {
        const dialog = await openDialog(page);
        await dialog.getByLabel("Instagram link").fill("https://www.instagram.com/reel/ABCdef12345/");
        await dialog.getByRole("radio", { name: "Google Drive" }).click();
        await dialog.getByRole("button", { name: /Folder: My Drive \/ My Drive/ }).click();
        await page.getByRole("button", { name: "Open Instagram saves" }).click();
        await page.getByRole("button", { name: "Save here" }).click();
        await expect(dialog.getByRole("button", { name: /Folder: My Drive \/ Instagram saves/ })).toBeVisible();
        await dialog.getByRole("button", { name: "Import 2 items" }).click();
        await expect.poll(async () => (await mutations(request)).some((r) => r.path === "/transfers/remote/instagram")).toBe(true);
        expect((await importBody(request)).destination).toEqual({ kind: "gdrive", account_id: "acc1", folder_id: "fold9", folder_name: "Instagram saves" });
    });

    test("the vault must be unlocked; a missing post shows why", async ({ page }) => {
        const dialog = await openDialog(page);
        await dialog.getByRole("radio", { name: "Private Vault" }).click();
        await expect(dialog.getByText("Your vault is locked.")).toBeVisible();
        await dialog.getByRole("button", { name: "Unlock" }).click();
        await expect(page.getByRole("dialog").filter({ hasText: /PIN/i }).first()).toBeVisible();
        await page.keyboard.press("Escape");
        await dialog.getByLabel("Instagram link").fill("https://www.instagram.com/p/MISSING123/");
        await expect(dialog.getByRole("alert")).toHaveText("This post is private or was removed.");
        await expect(dialog.getByRole("button", { name: /^Import/ })).toBeDisabled();
    });

    test("the owner connects Instagram with the browser's sign-in", async ({ page, request }) => {
        await page.goto("/settings?tab=integrations");
        await expect(page.getByRole("heading", { name: "Instagram" })).toBeVisible();
        await page.getByRole("button", { name: "Connect" }).last().click();
        await expect(page.getByLabel("Instagram username")).toBeVisible();
        await page.getByRole("button", { name: "Use my browser's sign-in" }).click();
        await page.getByLabel("sessionid").fill("1234567%3AAbCd12%3A9%3AAYx");
        await page.getByRole("button", { name: "Connect", exact: true }).last().click();
        await expect(page.getByText("Instagram connected as @spare.account")).toBeVisible();
        expect((await mutations(request)).find((r) => r.path === "/transfers/remote/instagram/session/browser").body).toBe('{"sessionid":"1234567%3AAbCd12%3A9%3AAYx"}');
    });
});

test.describe("sign-in and passwords", () => {
    test("login trims the username; Google is hidden when not set up", async ({ page, request }) => {
        await page.goto("/login");
        await expect(page.getByText("Forgot password?")).toBeVisible();
        await expect(page.getByText("Or continue with")).toHaveCount(0);
        // The website is the server; only the desktop app picks one
        await expect(page.getByText("Configure Backend URL")).toHaveCount(0);
        await page.getByLabel("Username").fill("yashsaxena15 ");
        await page.getByLabel("Password", { exact: true }).fill("right");
        await page.getByRole("button", { name: "Sign In" }).click();
        await expect.poll(async () => (await mutations(request)).find((r) => r.path === "/auth/login")?.body).toBe('{"username":"yashsaxena15","password":"right"}');
    });

    test("forgot password: code by email, then a new password", async ({ page, request }) => {
        await page.goto("/login");
        await page.getByText("Forgot password?").click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Username").fill("yashsaxena15");
        await dialog.getByRole("button", { name: "Send code" }).click();
        await expect(dialog.getByText(/sent a 6-digit code/)).toBeVisible();
        await dialog.getByLabel("Code from the email").fill("123456");
        await dialog.getByLabel("New password", { exact: true }).fill("brandnew1");
        await dialog.getByLabel("Repeat new password").fill("brandnew1");
        await dialog.getByRole("button", { name: "Set new password" }).click();
        await expect(page.getByText("Password changed. Sign in with your new password.")).toBeVisible();
        const reset = (await mutations(request)).find((r) => r.path === "/auth/forgot-password/reset");
        expect(JSON.parse(reset.body)).toEqual({ username: "yashsaxena15", code: "123456", new_password: "brandnew1" });
    });

    test("owner sets a new password without the old one", async ({ page, request }) => {
        await page.goto("/settings?tab=users");
        await page.getByRole("button", { name: "Actions for family" }).click();
        await page.getByRole("menuitem", { name: "Set a new password" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByLabel("Current password")).toHaveCount(0);
        await dialog.getByLabel("New password", { exact: true }).fill("fresh123");
        await dialog.getByRole("button", { name: "Set password" }).click();
        await expect.poll(async () => (await mutations(request)).find((r) => r.path === "/user/u2/password")?.body).toBe('{"current_password":"","new_password":"fresh123"}');
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

    test("upload a file from the New menu", async ({ page, request }) => {
        await page.goto("/");
        await row(page, "Movies").dblclick();
        await expect(row(page, "Arrival.2016.1080p.mkv")).toBeVisible();
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "New", exact: true }).first().click();
        await page.getByRole("menuitem", { name: /Upload files/ }).click();
        await (await chooser).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
        await expect.poll(async () => (await mutations(request)).some((r) => r.path.startsWith("/files/upload") && r.body.includes("notes.txt") && r.body.includes("/Home/Movies"))).toBe(true);
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

test.describe("player panels", () => {
    test("settings, details, playlist and minimize to the dock", async ({ page }) => {
        await page.goto("/");
        await row(page, "Movies").dblclick();
        await row(page, "Arrival.2016.1080p.mkv").dblclick();
        const video = page.locator("video");
        await expect.poll(() => video.evaluate((v) => !v.paused)).toBe(true);
        // Settings: change speed
        await page.getByRole("button", { name: "Settings" }).click();
        const speed = page.getByRole("region", { name: "Playback speed" }).or(page.locator('section[aria-label="Playback speed"]'));
        await speed.getByRole("button", { name: /1\.5/ }).click();
        await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(1.5);
        await page.keyboard.press("Escape");
        // File details
        await page.getByRole("button", { name: "File details" }).click();
        await expect(page.getByText("Media Details")).toBeVisible();
        await page.getByRole("button", { name: "Close details" }).click();
        await expect(page.getByText("Media Details")).toHaveCount(0);
        // Playlist lists the folder's videos
        await page.getByRole("button", { name: "Playlist" }).first().click();
        await expect(page.getByText("Blade.Runner.2049.mkv").first()).toBeVisible();
        await page.keyboard.press("Escape");
        // Minimize: keeps playing in the dock, from the same position
        const before = await video.evaluate((v) => v.currentTime);
        await page.getByRole("button", { name: "Minimize to dock" }).click();
        await expect(page.getByRole("button", { name: "Open video in theater mode" }).first()).toBeVisible();
        await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeGreaterThan(before);
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
