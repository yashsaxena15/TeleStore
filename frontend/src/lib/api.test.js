import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// api.js reads localStorage when it loads, so give the test a small stand-in first
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis.window || { location: { origin: "http://app.test" } };

let mod;
beforeAll(async () => {
    mod = await import("./api");
});
beforeEach(() => {
    store.clear();
    store.set("serverUrl", "http://api.test");
});

const respond = (status, body) => new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("messageFromBody", () => {
    it("reads FastAPI detail strings, validation lists and plain messages", () => {
        expect(mod.messageFromBody({ detail: "Incorrect vault PIN." }, "x")).toBe("Incorrect vault PIN.");
        expect(mod.messageFromBody({ detail: [{ msg: "field required" }, { msg: "too short" }] }, "x")).toBe("field required; too short");
        expect(mod.messageFromBody({ message: "Nope" }, "x")).toBe("Nope");
        expect(mod.messageFromBody(null, "Fallback")).toBe("Fallback");
    });
});

describe("request", () => {
    it("builds the URL, skips empty query values and sends JSON with cookies", async () => {
        const fetchMock = vi.fn(async () => respond(200, { ok: true }));
        vi.stubGlobal("fetch", fetchMock);
        await mod.request("/files", { method: "POST", body: { a: 1 }, query: { path: "/Home", page: 2, sort_by: undefined, q: "" } });
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe("http://api.test/files?path=%2FHome&page=2");
        expect(options.method).toBe("POST");
        expect(options.credentials).toBe("include");
        expect(options.headers["content-type"] || options.headers["Content-Type"]).toBe("application/json");
        expect(options.body).toBe('{"a":1}');
    });
    it("throws ApiError with the server's message and status", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => respond(429, { detail: "Too many wrong attempts. Try again in 1 minute." })));
        await expect(mod.request("/vault/unlock", { method: "POST", body: { pin: "1234" }, fallback: "Incorrect PIN" })).rejects.toMatchObject({ name: "ApiError", status: 429, message: "Too many wrong attempts. Try again in 1 minute." });
    });
    it("uses the fallback text, or the sign-in message for 401", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => respond(500, "oops")));
        await expect(mod.request("/x", { fallback: "Failed to fetch files" })).rejects.toThrow("Failed to fetch files");
        vi.stubGlobal("fetch", vi.fn(async () => respond(401, {})));
        await expect(mod.request("/x")).rejects.toThrow("Authentication required. Please log in again.");
    });
    it("returns the soft value instead of throwing, and handles empty bodies", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => respond(503, {})));
        expect(await mod.request("/transfers/remote/tasks", { soft: { tasks: [] } })).toEqual({ tasks: [] });
        vi.stubGlobal("fetch", vi.fn(async () => respond(200, "")));
        expect(await mod.request("/x")).toBe(null);
    });
    it("sends FormData without a JSON content type", async () => {
        const fetchMock = vi.fn(async () => respond(200, {}));
        vi.stubGlobal("fetch", fetchMock);
        const form = new FormData();
        form.append("file", new Blob(["x"]), "a.torrent");
        await mod.request("/transfers/remote/upload-torrent", { method: "POST", body: form });
        const options = fetchMock.mock.calls[0][1];
        expect(options.body).toBe(form);
        expect(options.headers["content-type"] || options.headers["Content-Type"]).toBeUndefined();
    });
});
