"""Phase 10: your own files straight from Telegram, through the app's own server on 127.0.0.1."""

import asyncio
from types import SimpleNamespace

import pytest

from telestore_desktop import media_server as ms
from telestore_desktop.items import Item

DATA = bytes(range(256)) * 4  # 1024 bytes: part 1 = 0..599, part 2 = 600..1023
PARTS = [{"chat_id": -100, "message_id": 1, "size": 600, "start": 0},
         {"chat_id": -100, "message_id": 2, "size": 424, "start": 600}]


class FakeClient:
    def __init__(self):
        self.streams = []

    async def get_messages(self, chat_id, message_id):
        return SimpleNamespace(id=message_id, empty=False)

    async def stream_media(self, msg, limit=0, offset=0):
        part = PARTS[msg.id - 1]
        body = DATA[part["start"]:part["start"] + part["size"]]
        self.streams.append((msg.id, offset))
        for i in range(offset * ms.CHUNK, len(body), ms.CHUNK):
            yield body[i:i + ms.CHUNK]


class FakeAccount:
    def __init__(self):
        self.client = FakeClient()
        self.chats = []

    async def ensure_chat(self, chat_id):
        self.chats.append(chat_id)


class FakeApi:
    def __init__(self, fail=False):
        self.fail, self.asked = fail, []

    def locate(self, file_id):
        self.asked.append(file_id)
        if self.fail:
            raise RuntimeError("Private Vault files open through the server.")
        return {"id": file_id, "name": "film.mkv", "size": len(DATA), "parts": PARTS}

    def server_file_url(self, item, inline=True):
        return f"https://ts.example/dl/{item.name}?file_id={item.id}" + ("&inline=1" if inline else "")


async def _get(port, path, headers=None, method="GET"):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    head = f"{method} {path} HTTP/1.1\r\nHost: x\r\n" + "".join(f"{k}: {v}\r\n" for k, v in (headers or {}).items()) + "\r\n"
    writer.write(head.encode())
    await writer.drain()
    raw = await reader.read()
    writer.close()
    top, _, body = raw.partition(b"\r\n\r\n")
    lines = top.decode().split("\r\n")
    status = int(lines[0].split()[1])
    hdrs = {k.lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:])}
    return status, hdrs, body


def _run(test, api=None):
    async def go():
        server = ms.MediaServer(FakeAccount(), api or FakeApi())
        await server.start()
        try:
            return await test(server)
        finally:
            await server.stop()
    return asyncio.run(go())


@pytest.fixture(autouse=True)
def small_chunks(monkeypatch):
    monkeypatch.setattr(ms, "CHUNK", 100)


def _path(server, item_id="abc", name="film.mkv", query=""):
    return f"/{server.secret}/f/{item_id}/{name}{query}"


def test_the_whole_file_across_parts():
    async def t(server):
        return await _get(server.port, _path(server))
    status, h, body = _run(t)
    assert status == 200 and body == DATA
    assert h["content-length"] == str(len(DATA)) and h["accept-ranges"] == "bytes" and h["content-type"] == "video/x-matroska"


def test_a_range_across_the_two_parts_starts_at_the_right_chunk():
    async def t(server):
        r = await _get(server.port, _path(server), {"Range": "bytes=550-649"})
        return r, server.account.client.streams
    (status, h, body), streams = _run(t)
    assert status == 206 and body == DATA[550:650]
    assert h["content-range"] == f"bytes 550-649/{len(DATA)}"
    assert streams == [(1, 5), (2, 0)]  # part 1 from its 6th chunk, part 2 from its start


def test_open_ended_and_last_bytes():
    async def t(server):
        return (await _get(server.port, _path(server), {"Range": "bytes=1000-"}),
                await _get(server.port, _path(server), {"Range": "bytes=-24"}))
    (s1, _, b1), (s2, _, b2) = _run(t)
    assert (s1, b1) == (206, DATA[1000:]) and (s2, b2) == (206, DATA[-24:])


def test_past_the_end():
    async def t(server):
        return await _get(server.port, _path(server), {"Range": "bytes=5000-"})
    status, h, _ = _run(t)
    assert status == 416 and h["content-range"] == f"bytes */{len(DATA)}"


def test_head_has_no_body():
    async def t(server):
        return await _get(server.port, _path(server), method="HEAD")
    status, h, body = _run(t)
    assert status == 200 and body == b"" and h["content-length"] == str(len(DATA))


def test_the_secret_is_needed():
    async def t(server):
        return await _get(server.port, "/wrong/f/abc/film.mkv")
    assert _run(t)[0] == 404


def test_download_asks_to_save():
    async def t(server):
        return await _get(server.port, _path(server, query="?download=1"))
    assert _run(t)[1]["content-disposition"].startswith("attachment")


def test_anything_it_cant_serve_goes_to_the_teleStore_server():
    async def t(server):
        return await _get(server.port, _path(server, name="pin.txt", query="?download=1"))
    status, h, _ = _run(t, FakeApi(fail=True))
    assert status == 302 and h["location"] == "https://ts.example/dl/pin.txt?file_id=abc"


def test_where_a_file_is_is_asked_once():
    api = FakeApi()

    async def t(server):
        await _get(server.port, _path(server), {"Range": "bytes=0-9"})
        await _get(server.port, _path(server), {"Range": "bytes=10-19"})
    _run(t, api)
    assert api.asked == ["abc"]


def test_addresses_only_for_your_own_files():
    server = ms.MediaServer(FakeAccount(), FakeApi())
    server.port = 5555
    own = server.url(Item(id="a b", name="My film.mkv", kind="video"))
    assert own.startswith(f"http://127.0.0.1:5555/{server.secret}/f/a%20b/My%20film.mkv")
    assert server.url(Item(id="x", name="s.mkv", kind="video", share_id="s1")) is None
    assert server.url(Item(id="x", name="F", kind="folder")) is None
    assert server.url(Item(id="x", name="a.pdf", kind="pdf"), inline=False).endswith("?download=1")


def test_the_api_prefers_the_direct_address():
    from telestore_desktop.api import TeleStoreApi
    api = TeleStoreApi("https://ts.example", "tok")
    item = Item(id="1", name="a.mkv", kind="video")
    assert api.file_url(item).startswith("https://ts.example/dl/")
    api.direct = lambda it, inline: "http://127.0.0.1:1/s/f/1/a.mkv"
    assert api.file_url(item) == "http://127.0.0.1:1/s/f/1/a.mkv"
    shared = Item(id="2", name="b.mkv", kind="video", share_id="s9")
    assert api.file_url(shared).startswith("https://ts.example/shares/s9/dl/2")
