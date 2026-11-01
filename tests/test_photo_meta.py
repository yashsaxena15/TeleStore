"""Photos' own details on a file: archive, caption, date and location (POST /files/{id}/photo-meta)."""

from telestore.db.repositories.files import Files
from test_protection import bob, files  # noqa: F401  (fixtures)


def meta(client, doc, **body):
    return client.post(f"/files/{doc['_id']}/photo-meta", json=body)


def test_archive_and_unarchive(client, bob):  # noqa: F811
    doc = bob.add("IMG_1.jpg", "/Home/Phone Backup/Camera", "photo")
    r = meta(client, doc, archived=True)
    assert r.status_code == 200 and r.json()["archived"] is True
    assert doc["archived"] is True
    assert meta(client, doc, archived=False).json()["archived"] is False


def test_caption_is_trimmed_and_cleared(client, bob):  # noqa: F811
    doc = bob.add("IMG_2.jpg", kind="photo")
    assert meta(client, doc, caption="  At the zoo  ").json()["caption"] == "At the zoo"
    assert meta(client, doc, caption="").json()["caption"] is None
    assert meta(client, doc, caption="x" * 2001).status_code == 400


def test_only_sent_fields_change(client, bob):  # noqa: F811
    doc = bob.add("IMG_3.jpg", kind="photo", caption="keep", archived=True)
    r = meta(client, doc, place="Gandhinagar, Gujarat").json()
    assert r["caption"] == "keep" and r["archived"] is True and r["place"] == "Gandhinagar, Gujarat"


def test_date_is_stored_in_utc(client, bob):  # noqa: F811
    doc = bob.add("IMG_4.jpg", kind="photo", taken_at="2026-11-01T12:31:00Z")
    assert meta(client, doc, taken_at="2026-11-01T18:01:00+05:30").json()["taken_at"] == "2026-11-01T12:31:00Z"
    assert meta(client, doc, taken_at="2025-01-02T03:04:05").json()["taken_at"] == "2025-01-02T03:04:05Z"
    assert meta(client, doc, taken_at="yesterday").status_code == 400


def test_location_needs_both_halves_in_range(client, bob):  # noqa: F811
    doc = bob.add("IMG_5.jpg", kind="photo")
    r = meta(client, doc, latitude=23.2, longitude=72.6).json()
    assert (r["latitude"], r["longitude"]) == (23.2, 72.6)
    assert meta(client, doc, latitude=23.2).status_code == 400
    assert meta(client, doc, latitude=95, longitude=10).status_code == 400
    cleared = meta(client, doc, latitude=None, longitude=None).json()
    assert cleared["latitude"] is None and cleared["longitude"] is None


def test_folders_and_other_peoples_files_are_refused(client, bob):  # noqa: F811
    folder = bob.add("Trip", kind="folder")
    assert meta(client, folder, archived=True).status_code == 400
    theirs = bob.add("IMG_6.jpg", kind="photo", owner_id="99")
    assert meta(client, theirs, archived=True).status_code == 404


class _Capture:
    """Stands in for the Files collection to see the query Photos sends."""

    def __init__(self):
        self.queries = []

    def find(self, query, *a, **k):
        self.queries.append(query)
        return []


def test_archived_photos_stay_out_of_the_timeline_and_show_in_archive():
    stub = _Capture()
    Files.get_files_by_path(stub, path="all", owner_id="42", kind="media", under="/Home/Phone Backup")
    assert stub.queries[-1]["archived"] == {"$ne": True}
    Files.get_files_by_path(stub, path="archive", owner_id="42")
    assert stub.queries[-1]["archived"] is True and stub.queries[-1]["trashed"] == {"$ne": True}
    # Other lists (a folder, Starred) still show archived files
    Files.get_files_by_path(stub, path="/Home/Phone Backup/Camera", owner_id="42")
    assert "archived" not in stub.queries[-1]
