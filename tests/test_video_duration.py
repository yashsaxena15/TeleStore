"""Video lengths for Photos' tiles: sent with uploads, set by the app, read in the background."""

import asyncio
import json
import subprocess
from unittest.mock import patch

from telestore.services import video_duration
from test_protection import bob, files  # noqa: F401  (fixtures)


def test_probe_reads_ffprobes_answer():
    reply = subprocess.CompletedProcess([], 0, stdout=json.dumps({"format": {"duration": "38.25"}}), stderr="")
    with patch.object(subprocess, "run", return_value=reply) as run:
        assert video_duration.probe("http://x/v.mp4") == 38.25
    assert run.call_args.args[0][0] == "ffprobe"
    for bad in ("{}", json.dumps({"format": {"duration": "N/A"}}), json.dumps({"format": {"duration": "0"}})):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=bad, stderr="")):
            assert video_duration.probe("http://x/v.mp4") is None
    with patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired("ffprobe", 45)):
        assert video_duration.probe("http://x/v.mp4") is None


def test_only_videos_without_a_length_are_read_and_each_once(files):  # noqa: F811
    video_duration._tried.clear()
    a = files.add("VID_1.mp4", kind="video")
    b = files.add("clip.MOV", kind="document")
    files.add("VID_2.mp4", kind="video", duration=12.0)
    files.add("IMG_1.jpg", kind="photo")
    listed = [{"id": str(d["_id"]), **{k: v for k, v in d.items() if k != "_id"}} for d in files.docs]
    todo = video_duration.missing(listed)
    assert [f["file_name"] for f in todo] == ["VID_1.mp4", "clip.MOV"]

    with patch.object(video_duration, "probe", side_effect=[38.25, None]):
        saved = asyncio.run(video_duration.fill(todo, lambda f: f"http://x/{f['file_name']}"))
    assert saved == 1 and a["duration"] == 38.25 and "duration" not in b
    # Tried once: not again this run
    assert video_duration.missing(listed) == []


def test_the_app_can_set_a_length(client, bob):  # noqa: F811
    doc = bob.add("VID_3.mp4", kind="video")
    r = client.post(f"/files/{doc['_id']}/photo-meta", json={"duration": 38.2504})
    assert r.status_code == 200 and r.json()["duration"] == 38.25
    assert client.post(f"/files/{doc['_id']}/photo-meta", json={"duration": 0}).status_code == 400
    assert client.post(f"/files/{doc['_id']}/photo-meta", json={"duration": None}).status_code == 400
