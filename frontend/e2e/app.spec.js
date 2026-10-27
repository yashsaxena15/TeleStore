// End-to-end checks of the main screens against the mock backend (see e2e/mock-server.mjs).
import fs from "node:fs";
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

test.describe("trash, starter folders and new transfers", () => {
    test("Home in the Trash breadcrumb goes home without looping", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("complementary").first().getByRole("button", { name: "Trash" }).click();
        await expect(row(page, "old-notes.txt")).toBeVisible();
        const before = await page.evaluate(() => history.length);
        await page.getByRole("button", { name: "Home", exact: true }).nth(1).click();
        await expect(row(page, "Movies")).toBeVisible();
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => history.length) - before).toBeLessThanOrEqual(1);
        await expect(page).toHaveURL(/\/$/);
    });

    test("items in Trash can't be dragged into a folder", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("complementary").first().getByRole("button", { name: "Trash" }).click();
        await row(page, "old-notes.txt").dragTo(row(page, "Old stuff"));
        await expect(page.getByText(/Items in Trash can't be moved/).first()).toBeVisible();
        expect((await mutations(request)).some((r) => r.path === "/files/move")).toBe(false);
    });

    test("a starter folder like Documents can be deleted", async ({ page, request }) => {
        await page.goto("/");
        await row(page, "Documents").click({ button: "right" });
        const del = page.getByRole("menuitem", { name: /Delete|Move to Trash/i }).first();
        await expect(del).toBeEnabled();
        await del.click();
        const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
        await confirm.getByRole("button", { name: /Delete|Move to Trash/i }).last().click();
        await expect.poll(async () => (await mutations(request)).some((r) => /delete|trash/.test(r.path) && r.body.includes("f2"))).toBe(true);
    });

    test("right-click Move to Trash acts on every selected item", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Select Movies" }).click();
        await page.getByRole("button", { name: "Select Music" }).click();
        await page.getByRole("button", { name: "Select Documents" }).click();
        await row(page, "Music").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Move to Trash (3)" }).click();
        const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
        await confirm.getByRole("button", { name: /Delete|Move to Trash/i }).last().click();
        await expect.poll(async () => (await mutations(request)).filter((r) => r.path === "/files/trash").map((r) => JSON.parse(r.body).file_id).sort()).toEqual(["f1", "f2", "f3"]);
    });

    test("New transfer offers leech, video and Instagram", async ({ page }) => {
        await page.goto("/transfers");
        await page.getByRole("button", { name: "New transfer" }).first().click();
        await expect(page.getByRole("menuitem", { name: /Remote leech/ })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: /Import from Instagram/ })).toBeVisible();
        await page.getByRole("menuitem", { name: /Download video or audio/ }).click();
        await expect(page.getByRole("dialog", { name: "Download video or audio" })).toBeVisible();
    });
});

test.describe("large downloads", () => {
    test("a big file goes to the browser's own downloads", async ({ page, request }) => {
        await page.goto("/");
        await row(page, "Music").dblclick();
        await page.getByRole("button", { name: "Select huge-backup.zip" }).click();
        const download = page.waitForEvent("download");
        await page.getByRole("toolbar", { name: "1 selected" }).getByRole("button", { name: /^Download/ }).click();
        expect((await download).suggestedFilename()).toBe("huge-backup.zip");
        // Saved by the browser (straight to disk), not collected in the page's memory
        const calls = (await mutations(request)).filter((r) => r.path === "/dl/huge-backup.zip");
        expect(calls.map((c) => c.method)).toEqual(["HEAD", "GET"]);
        expect(calls[1].body).toMatch(/file_id=f500/);
        expect(calls[1].body).toMatch(/download=1/);
        await page.goto("/transfers");
        await expect(page.getByText("In browser downloads").first()).toBeVisible();
    });
});

test.describe("staying signed in", () => {
    test("moving between pages doesn't re-check the sign-in", async ({ page }) => {
        let checks = 0;
        page.on("request", (r) => { if (new URL(r.url()).pathname === "/auth/check") checks++; });
        await page.goto("/");
        await expect(row(page, "Movies")).toBeVisible();
        const sidebar = page.getByRole("complementary").first();
        for (const name of ["Transfers", "Storage", "Home", "Transfers", "Home"])
            await sidebar.getByRole("button", { name }).click();
        await expect(row(page, "Movies")).toBeVisible();
        expect(checks).toBe(1);
    });

    test("a slow or dropped check doesn't sign you out", async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem("auth_token", "kept-token"));
        let calls = 0;
        await page.route("**/auth/check", async (route) => {
            calls++;
            if (calls === 1)
                return route.abort("connectionreset");
            await new Promise((r) => setTimeout(r, 4000)); // slower than the old 3-second limit
            return route.continue();
        });
        await page.goto("/");
        await expect(row(page, "Movies")).toBeVisible({ timeout: 15000 });
        await expect(page).not.toHaveURL(/\/login/);
        expect(await page.evaluate(() => localStorage.getItem("auth_token"))).toBe("kept-token");
    });
});

test.describe("video and audio downloads", () => {
    const openDialog = async (page) => {
        await page.goto("/");
        await page.getByRole("button", { name: "New", exact: true }).first().click();
        await page.getByRole("menuitem", { name: /Download video or audio/ }).click();
        const dialog = page.getByRole("dialog", { name: "Download video or audio" });
        await expect(dialog).toBeVisible();
        return dialog;
    };
    const downloadBody = async (request) => JSON.parse((await mutations(request)).find((r) => r.path === "/transfers/remote/media").body);

    test("one video as MP3 into the open folder", async ({ page, request }) => {
        const dialog = await openDialog(page);
        // Copied from a chat with the message time stuck to it
        await dialog.getByLabel("Link", { exact: true }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ 05:23 PM");
        await expect(dialog.getByLabel("Link", { exact: true })).toHaveValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        await expect(dialog.getByLabel("Link preview")).toContainText("Never Gonna Give You Up");
        await expect(dialog.getByLabel("Link preview")).toContainText("3:33");
        await dialog.getByRole("radio", { name: "Audio only" }).click();
        // The site's own audio first; MP3 320 says it won't sound better than the 130 kbps source
        await dialog.getByLabel("Audio format").selectOption("mp3:320");
        await expect(dialog.getByText(/source is 130 kbps/)).toBeVisible();
        await dialog.getByRole("button", { name: "Download", exact: true }).click();
        await expect(page.getByText("Downloading 2 video files.")).toBeVisible();
        expect(await downloadBody(request)).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", choice: { mode: "audio", audio_format: "mp3", audio_bitrate: "320" }, destination: { kind: "home", path: "/Home" }, sync: false });
    });

    test("the quality list shows exactly what the video has", async ({ page, request }) => {
        const dialog = await openDialog(page);
        await dialog.getByLabel("Link", { exact: true }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        await expect(dialog.getByLabel("Link preview")).toContainText("Never Gonna Give You Up");
        const options = await dialog.getByLabel("Quality").locator("option").allTextContents();
        expect(options[0]).toBe("Best available (2160p)");
        expect(options.slice(1, 9).map((o) => o.split(" ")[0])).toEqual(["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"]);
        expect(options.at(-1)).toMatch(/Most compatible/);
        await dialog.getByLabel("Quality").selectOption("2160");
        await dialog.getByRole("button", { name: "Download", exact: true }).click();
        await expect.poll(async () => (await mutations(request)).some((r) => r.path === "/transfers/remote/media")).toBe(true);
        expect((await downloadBody(request)).choice.quality).toBe("2160");
    });

    test("Facebook shows its HD and SD versions", async ({ page, request }) => {
        const dialog = await openDialog(page);
        await dialog.getByLabel("Link", { exact: true }).fill("https://www.facebook.com/facebook/videos/10153231379946729/");
        await expect(dialog.getByLabel("Link preview")).toContainText("How to Share With Just Friends");
        expect(await dialog.getByLabel("Quality").locator("option").allTextContents()).toEqual(["Best available", "HD", "SD"]);
        await dialog.getByLabel("Quality").selectOption("fmt:hd");
        await dialog.getByRole("button", { name: "Download", exact: true }).click();
        await expect.poll(async () => (await mutations(request)).some((r) => r.path === "/transfers/remote/media")).toBe(true);
        expect((await downloadBody(request)).choice.quality).toBe("fmt:hd");
    });

    test("chosen playlist videos at 720p with subtitles", async ({ page, request }) => {
        const dialog = await openDialog(page);
        await dialog.getByLabel("Link", { exact: true }).fill("https://www.youtube.com/playlist?list=PL123");
        await expect(dialog.getByLabel("Link preview")).toContainText("Playlist · 3 videos");
        await expect(dialog.getByLabel("Playlist videos")).toContainText("1:02:05");
        await dialog.getByRole("checkbox", { name: /Song two/ }).uncheck();
        await dialog.getByLabel("Quality").selectOption("720");
        await dialog.getByLabel("Subtitles").selectOption("hi");
        await dialog.getByRole("checkbox", { name: /Also download new videos automatically/ }).check();
        await dialog.getByRole("button", { name: "Download 2 videos" }).click();
        await expect.poll(async () => (await mutations(request)).some((r) => r.path === "/transfers/remote/media")).toBe(true);
        const body = await downloadBody(request);
        expect(body.items).toEqual([1, 3]);
        expect(body.sync).toBe(true);
        expect(body.choice).toEqual({ mode: "video", quality: "720", subtitles: "hi" });
    });

    test("a refused link says why", async ({ page }) => {
        const dialog = await openDialog(page);
        await dialog.getByLabel("Link", { exact: true }).fill("http://127.0.0.1:8000/admin");
        await expect(dialog.getByRole("alert")).toHaveText("Links to private or local network addresses can't be downloaded.");
        await expect(dialog.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
    });

    test("the owner adds a cookies.txt", async ({ page }) => {
        await page.goto("/settings?tab=integrations");
        await expect(page.getByRole("heading", { name: "Video downloads" })).toBeVisible();
        await expect(page.getByText("yt-dlp 2026.10.21")).toBeVisible();
        await page.getByLabel("cookies.txt file").setInputFiles({ name: "cookies.txt", mimeType: "text/plain", buffer: Buffer.from("# Netscape HTTP Cookie File\n") });
        await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
        await expect(page.getByText(/YouTube confirmed the sign-in/).first()).toBeVisible();
        await expect(page.getByText("Bot-check helper running")).toBeVisible();
    });

    test("the owner updates yt-dlp", async ({ page }) => {
        await page.goto("/settings?tab=integrations");
        await page.getByRole("button", { name: "Update yt-dlp" }).click();
        await expect(page.getByText("yt-dlp is now 2026.11.03")).toBeVisible();
        await expect(page.getByText(/yt-dlp 2026.11.03 \(updated; built-in 2026.10.21\)/)).toBeVisible();
        await expect(page.getByRole("button", { name: "Use the built-in version" })).toBeVisible();
    });

    test("synced playlists can be checked, paused and removed", async ({ page, request }) => {
        await page.goto("/settings?tab=integrations");
        const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Synced playlists" }) });
        await expect(panel).toContainText("Daily mix");
        await expect(panel).toContainText("Playlist · MP3 · to /Home/Music");
        await panel.getByRole("button", { name: "Check now" }).click();
        await expect(page.getByText("3 new videos queued")).toBeVisible();
        await panel.getByRole("button", { name: "Pause" }).click();
        await expect.poll(async () => (await mutations(request)).find((r) => r.path === "/transfers/remote/media/syncs/sync_1")?.body).toBe('{"enabled":false}');
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

    test("your devices: this one is marked, others can be signed out", async ({ page, request }) => {
        await page.goto("/settings?tab=account");
        const list = page.getByRole("list", { name: "Signed-in devices" });
        await expect(list.getByRole("listitem").filter({ hasText: "Chrome on Linux" }).getByText("This device")).toBeVisible();
        await expect(list.getByRole("button", { name: "Sign out Chrome on Linux" })).toHaveCount(0);
        await list.getByRole("button", { name: "Sign out Android app" }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Sign out" }).click();
        await expect(list.getByText("Android app")).toHaveCount(0);
        expect((await mutations(request)).some((r) => r.method === "DELETE" && r.path === "/auth/devices/d2")).toBe(true);
        // Only one other left: no "all others" button needed
        await expect(page.getByRole("button", { name: "Sign out all others" })).toHaveCount(0);
    });

    test("sign out all other devices", async ({ page, request }) => {
        await page.goto("/settings?tab=account");
        await page.getByRole("button", { name: "Sign out all others" }).click();
        await expect(page.getByRole("alertdialog").getByText("Sign out 2 other devices?")).toBeVisible();
        await page.getByRole("alertdialog").getByRole("button", { name: "Sign out" }).click();
        await expect(page.getByText("You're only signed in here.")).toBeVisible();
        expect((await mutations(request)).some((r) => r.path === "/auth/devices/sign-out-others")).toBe(true);
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

        // The list redraws after the star (and when offline marks load): open the menu again if a click lands mid-redraw
        await expect(async () => {
            await page.getByRole("button", { name: "More actions for project-src.zip" }).first().click();
            await expect(page.getByRole("menuitem", { name: /Rename/ })).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 15000 });
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
        // 5 bytes in 2-byte chunks, sent together as raw bodies; chunk 1 is told to wait (429) once
        await expect.poll(async () => (await mutations(request)).some((r) => r.path === "/files/upload/complete")).toBe(true);
        const puts = (await mutations(request)).filter((r) => r.method === "PUT" && r.path.startsWith("/files/upload/chunk/up1/"));
        const indexes = puts.map((r) => Number(r.path.split("/").pop()));
        expect([...new Set(indexes)].sort()).toEqual([0, 1, 2]);
        expect(indexes.filter((i) => i === 1)).toHaveLength(2); // asked to wait, then sent again
        expect(puts.find((r) => r.path.endsWith("/0")).body).toBe("he"); // the raw bytes, no form wrapping
    });

    test("an upload continues after a page reload", async ({ page, request }, testInfo) => {
        // The same file picked again (same name, size and modification time) after a reload
        const filePath = testInfo.outputPath("notes.txt");
        fs.writeFileSync(filePath, "hello");
        fs.utimesSync(filePath, 1_700_000_000, 1_700_000_000);
        // What the page remembered before the reload: this file belongs to session up-old
        await page.addInitScript(() => {
            localStorage.setItem("telestore.uploadResume", JSON.stringify({ "/Home/Movies|notes.txt|5|1700000000000": "up-old" }));
        });
        await page.goto("/");
        await row(page, "Movies").dblclick();
        await expect(row(page, "Arrival.2016.1080p.mkv")).toBeVisible();
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "New", exact: true }).first().click();
        await page.getByRole("menuitem", { name: /Upload files/ }).click();
        await (await chooser).setFiles(filePath);
        await expect.poll(async () => (await mutations(request)).some((r) => r.path === "/files/upload/complete")).toBe(true);
        const sent = (await mutations(request)).filter((r) => r.method === "PUT").map((r) => r.path);
        expect(sent.every((p) => p.startsWith("/files/upload/chunk/up-old/"))).toBe(true);
        expect([...new Set(sent.map((p) => Number(p.split("/").pop())))].sort()).toEqual([1, 2]); // chunk 0 was already there
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
    test("a long audio queue scrolls and opens at the playing song", async ({ page }) => {
        await page.goto("/");
        await row(page, "Music").dblclick();
        await row(page, "Song 14.mp3").dblclick();
        await page.getByRole("button", { name: "Queue" }).click();
        const list = page.getByLabel("Queue list");
        const playing = list.locator('[aria-current="true"]');
        await expect(playing).toContainText("Song 14");
        await expect(playing).toBeInViewport();
        // Every song can be reached
        await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await expect(list.getByRole("button", { name: /Song 20/ })).toBeInViewport();
        await list.getByRole("button", { name: /Song 20/ }).click();
        await expect(page.getByText(/track 20 of 20/)).toBeVisible();
    });

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
        await page.getByRole("button", { name: "Playlist", exact: true }).first().click();
        await expect(page.getByText("Blade.Runner.2049.mkv").first()).toBeVisible();
        await page.keyboard.press("Escape");
        // Minimize: the same video keeps playing in the dock, without a pause or a reload
        const before = await video.evaluate((v) => {
            v.dataset.e2e = "same-element";
            window.__pauses = 0;
            window.__loads = 0;
            v.addEventListener("pause", () => { window.__pauses++; });
            v.addEventListener("loadstart", () => { window.__loads++; });
            return v.currentTime;
        });
        await page.getByRole("button", { name: "Minimize to dock" }).click();
        await expect(page.getByRole("button", { name: "Open video in theater mode" }).first()).toBeVisible();
        await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeGreaterThan(before);
        await expect(page.locator('video[data-e2e="same-element"]')).toHaveCount(1);
        expect((await page.locator("video").boundingBox()).width).toBeLessThan(100); // shown in the dock thumbnail
        // …and back to theater mode
        await page.getByRole("button", { name: "Open video in theater mode" }).first().click();
        await expect(page.getByRole("button", { name: "Minimize to dock" })).toBeVisible();
        await page.waitForTimeout(500);
        await expect(page.locator('video[data-e2e="same-element"]')).toHaveCount(1);
        expect(await page.evaluate(() => [window.__pauses, window.__loads])).toEqual([0, 0]);
        expect(await page.locator("video").evaluate((v) => v.paused)).toBe(false);
        expect((await page.locator("video").boundingBox()).width).toBeGreaterThan(800); // fills the theater again
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
        await expect(page.getByLabel("Storage space")).toHaveText(/^of 100 TB · 99\.\d+ TB free$/);
    });
});

test.describe("phone @phone", () => {
    test("a tap shows the video controls and they stay a few seconds", async ({ page }) => {
        await page.goto("/");
        await row(page, "Movies").click();
        await row(page, "Arrival.2016.1080p.mkv").click();
        const video = page.locator("video");
        await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThan(0.2);
        const topBar = page.getByRole("button", { name: "Back / Close" }).locator("xpath=ancestor::div[contains(@class,'top-0')][1]");
        // Playing: the controls fade out by themselves
        await expect(topBar).toHaveClass(/opacity-0/, { timeout: 8000 });
        // One tap on the video brings them back, and they are still there 2 seconds later
        const box = await video.boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(topBar).toHaveClass(/opacity-100/);
        await page.waitForTimeout(2000);
        await expect(topBar).toHaveClass(/opacity-100/);
        // A second tap hides them right away
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(topBar).toHaveClass(/opacity-0/, { timeout: 1500 });
    });

    test("the controls row fits a phone and fullscreen turns the video sideways", async ({ page }) => {
        await page.addInitScript(() => {
            window.__locks = [];
            if (screen.orientation)
                screen.orientation.lock = (o) => { window.__locks.push(o); return Promise.resolve(); };
        });
        await page.goto("/");
        await row(page, "Movies").click();
        await row(page, "Arrival.2016.1080p.mkv").click();
        const video = page.locator("video");
        await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThan(0.2);
        // The controls show when playback starts. No 10-second buttons on a phone (double-tap the sides instead); fullscreen fits on screen
        await expect(page.getByRole("button", { name: "Rewind 10 seconds" })).toBeHidden();
        await expect(page.getByRole("button", { name: "Forward 10 seconds" })).toBeHidden();
        const fullscreen = page.getByRole("button", { name: "Fullscreen" });
        await expect(fullscreen).toBeInViewport({ ratio: 1 });
        await fullscreen.click();
        await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__locks)).toEqual(["landscape"]);
    });

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

test.describe("photos", () => {
    test("shows only the phone backup, by day, with previews for files without a thumbnail", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("complementary").first().getByRole("button", { name: "Photos" }).click();
        await expect(page).toHaveURL(/\/photos$/);
        await expect(page.getByRole("heading", { level: 1, name: "Photos" })).toBeVisible();
        await expect(page.getByText("3 items from your phone backup")).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Fri, 3 Jan 2025" })).toBeVisible();
        await expect(page.getByTestId("photo-tile")).toHaveCount(3);
        await expect(page.getByTestId("photo-tile").locator("img")).toHaveCount(3);
        const asked = (await mutations(request)).map((r) => r.path);
        // HEIC and the video have no Telegram thumbnail: the server makes previews
        expect(asked).toEqual(expect.arrayContaining(["/files/preview/ph1", "/files/preview/ph2", "/files/thumbnail/THUMB1"]));
        expect(asked).not.toContain("/files/preview/ph3");
    });

    test("select, star, and Escape ends the selection", async ({ page, request }) => {
        await page.goto("/photos");
        await page.getByRole("button", { name: "Select IMG_0003.HEIC" }).click();
        await expect(page.getByText("1 selected")).toBeVisible();
        await page.getByTestId("photo-tile").nth(1).click(); // while selecting, a click selects
        await expect(page.getByText("2 selected")).toBeVisible();
        await page.getByRole("toolbar", { name: "Selected photos" }).getByRole("button", { name: "Star" }).click();
        await expect(page.getByText("Starred 2 items")).toBeVisible();
        const stars = (await mutations(request)).filter((r) => r.path === "/files/star").map((r) => JSON.parse(r.body).file_id);
        expect(stars.sort()).toEqual(["ph1", "ph2"]);
        await page.getByRole("button", { name: "Select Today" }).click();
        await expect(page.getByText("2 selected")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("heading", { level: 1, name: "Photos" })).toBeVisible();
    });

    test("@phone Photos is in the More sheet", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "More" }).click();
        await page.getByRole("button", { name: "Photos" }).click();
        await expect(page).toHaveURL(/\/photos$/);
        await expect(page.getByTestId("photo-tile")).toHaveCount(3);
    });
});

test.describe("playlists", () => {
    test("@phone Playlists is in the More sheet and a playlist plays", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "More" }).click();
        await page.getByRole("button", { name: "Playlists" }).click();
        await expect(page).toHaveURL(/\/playlists$/);
        await page.getByRole("button", { name: /^Road trip/ }).click();
        await page.getByRole("button", { name: "Play", exact: true }).click();
        await expect(page.getByRole("button", { name: "Open now playing" })).toBeVisible();
    });

    test("open, reorder, remove and play a playlist; Liked music can't be deleted", async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("complementary").first().getByRole("button", { name: "Playlists" }).click();
        await expect(page).toHaveURL(/\/playlists$/);
        await expect(page.getByRole("button", { name: /^Liked music/ })).toBeVisible();
        await page.getByRole("button", { name: /^Road trip/ }).click();
        await expect(page).toHaveURL(/\/playlists\/pl1$/);
        await expect(page.getByRole("heading", { level: 1, name: "Road trip" })).toBeVisible();
        const list = page.getByRole("list", { name: "Road trip items" });
        await expect(list.getByRole("listitem")).toHaveCount(3);
        await page.getByRole("button", { name: "Move Song 04.mp3 up" }).click();
        await expect(list.getByRole("listitem").nth(1)).toContainText("Song 04");
        await page.getByRole("button", { name: "Remove Song 01.mp3 from the playlist" }).click();
        await expect(list.getByRole("listitem")).toHaveCount(2);
        const sent = (await mutations(request)).filter((r) => r.path.startsWith("/files/playlists/pl1"));
        expect(sent.map((r) => r.method)).toEqual(["PUT", "POST"]);
        expect(JSON.parse(sent[0].body).file_ids).toEqual(["f3000", "f3003", "f3002"]);
        await page.getByRole("button", { name: "Play", exact: true }).click();
        await expect(page.getByText(/track 1 of 2/)).toBeVisible();

        await page.getByRole("button", { name: "All playlists" }).click();
        await page.getByRole("button", { name: /^Liked music/ }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Liked music" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Playlist options" })).toHaveCount(0);
    });

    test("add a song from its menu, make a new playlist, and the heart", async ({ page, request }) => {
        await page.goto("/Music");
        await row(page, "Song 05.mp3").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Add to playlist" }).click();
        const dialog = page.getByRole("dialog", { name: "Add to playlist" });
        await dialog.getByRole("button", { name: /^Road trip/ }).click();
        await expect(page.getByText("Added 1 item to Road trip")).toBeVisible();
        const added = (await mutations(request)).find((r) => r.path === "/files/playlists/pl1/items");
        expect(JSON.parse(added.body).file_ids).toEqual(["f3004"]);

        await row(page, "Song 06.mp3").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Add to playlist" }).click();
        await dialog.getByRole("button", { name: "New playlist" }).click();
        await dialog.getByLabel("Playlist name").fill("Gym");
        await dialog.getByRole("button", { name: "Create" }).click();
        await expect(page.getByText("Added to Gym")).toBeVisible();

        // Song 02 is in Liked music: the heart shows it, and a click takes it out
        await row(page, "Song 02.mp3").dblclick();
        const heart = page.getByRole("button", { name: "Remove from Liked music" }).first();
        await expect(heart).toHaveAttribute("aria-pressed", "true");
        await heart.click();
        await expect(page.getByRole("button", { name: "Add to Liked music" }).first()).toBeVisible();
        const like = (await mutations(request)).find((r) => r.path === "/files/playlists/like");
        expect(JSON.parse(like.body)).toEqual({ file_id: "f3001", liked: false });
    });
});

test.describe("notifications", () => {
    test("the bell shows the unread count; a notification opens Transfers and is marked read", async ({ page, request }) => {
        await page.goto("/");
        const bell = page.getByRole("complementary").first().getByRole("button", { name: /^Notifications/ });
        await expect(bell.getByTestId("notification-badge")).toHaveText("1");
        await bell.click();
        await expect(page.getByText("New file in Telegram Inbox")).toBeVisible();
        await expect(page.getByText("5 min ago")).toBeVisible();
        await page.getByRole("button", { name: /Transfer finished/ }).click();
        await expect(page).toHaveURL(/\/transfers$/);
        await expect.poll(async () => (await mutations(request)).filter((r) => r.path === "/user/notifications/read").map((r) => JSON.parse(r.body))).toEqual([{ ids: ["n3"] }]);
        await expect(bell.getByTestId("notification-badge")).toHaveCount(0);
    });

    test("@phone Notifications and Offline are in the More sheet", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "More" }).click();
        await expect(page.getByRole("button", { name: /^Offline/ })).toBeVisible();
        await page.getByRole("button", { name: /^Notifications/ }).click();
        await expect(page.getByRole("button", { name: /Transfer finished/ })).toBeVisible();
        await page.getByRole("button", { name: "Mark all as read" }).click();
        await expect(page.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
    });
});

test.describe("offline files", () => {
    test("make a file available offline from its menu, see it on the Offline page, then remove it", async ({ page }) => {
        await page.goto("/");
        await row(page, "Q3-report.pdf").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Make available offline" }).click();
        await expect(page.getByText("“Q3-report.pdf” is available offline")).toBeVisible();
        await expect(row(page, "Q3-report.pdf").getByTestId("offline-mark").first()).toBeAttached();
        // The menu now offers to remove it
        await row(page, "Q3-report.pdf").click({ button: "right" });
        await expect(page.getByRole("menuitem", { name: "Remove offline copy" })).toBeVisible();
        await page.keyboard.press("Escape");

        await page.getByRole("complementary").first().getByRole("button", { name: "Offline" }).click();
        await expect(page).toHaveURL(/\/offline$/);
        const list = page.getByRole("list", { name: "Offline files" });
        await expect(list.getByRole("button", { name: "Open Q3-report.pdf" })).toBeVisible();
        await expect(page.getByText(/1 file · .* used/)).toBeVisible();
        // It opens from the copy saved in this browser, not from the server
        await list.getByRole("button", { name: "Open Q3-report.pdf" }).click();
        await expect(page.locator("iframe[title='Q3-report.pdf']")).toHaveAttribute("src", /^blob:/);
        await page.getByRole("button", { name: "Close document reader" }).click();
        await expect(page.locator("iframe[title='Q3-report.pdf']")).toHaveCount(0);
        await list.getByRole("button", { name: "Remove Q3-report.pdf" }).click();
        await expect(page.getByText(/Nothing saved yet/)).toBeVisible();
    });

    test.describe("without internet", () => {
        test.use({ serviceWorkers: "allow" });
        test("the site and the Offline page open with no connection", async ({ page, context }) => {
            await page.goto("/offline");
            await expect(page.getByRole("heading", { level: 1, name: "Offline" })).toBeVisible();
            await page.evaluate(async () => {
                await navigator.serviceWorker.ready;
                // Wait until the worker controls the page and has kept the built files
                for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
                for (let i = 0; i < 50; i++) {
                    const cache = await caches.open("telestore-shell-v1");
                    const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
                    if (keys.includes("/index.html") && keys.some((k) => /OfflinePage/.test(k))) return;
                    await new Promise((r) => setTimeout(r, 200));
                }
            });
            await context.setOffline(true);
            await page.reload();
            await expect(page.getByRole("heading", { level: 1, name: "Offline" })).toBeVisible({ timeout: 15000 });
            await expect(page.getByText(/You're offline/)).toBeVisible();
            await context.setOffline(false);
        });
    });
});
