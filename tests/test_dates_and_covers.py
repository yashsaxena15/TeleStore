"""File dates carry their UTC offset; songs get their built-in cover as the Telegram thumbnail."""

import asyncio
import shutil
import subprocess
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telestore.db.repositories.files import Files
from telestore.services import pipeline_uploader
from telestore.services.pipeline_uploader import extract_audio_cover, upload_part_task


def test_saved_files_have_a_utc_offset():
    repo = Files.__new__(Files)
    saved = {}
    with patch.object(Files, "find_one", return_value=None), patch.object(Files, "insert_one", side_effect=lambda d: saved.update(d)):
        repo.add_file(-100, 1, None, "audio", "u1", 10, "Strangers.mp3", "", "/Home")
    stamp = datetime.fromisoformat(saved["modified_date"])
    assert stamp.utcoffset() is not None and stamp.utcoffset().total_seconds() == 0


def _message(with_thumb=True):
    media = MagicMock(file_unique_id="u1", thumbs=[MagicMock(file_id="thumb1")] if with_thumb else [])
    return MagicMock(document=None, video=None, audio=media, photo=None, voice=None, id=5)


def test_songs_are_sent_with_their_cover(tmp_path):
    song = tmp_path / "Strangers.mp3"
    song.write_bytes(b"x" * 10)
    cover = tmp_path / "Strangers.mp3.cover.jpg"
    cover.write_bytes(b"jpg")
    client = MagicMock()
    client.send_audio = AsyncMock(return_value=_message())
    with patch.object(pipeline_uploader, "extract_audio_cover", AsyncMock(return_value=str(cover))):
        res = asyncio.run(upload_part_task(str(song), 1, "Strangers.mp3", 0, 10, -100, None, client, is_single_part=True, file_type="audio"))
    assert client.send_audio.call_args.kwargs["thumb"] == str(cover)
    assert res["thumbnail"] == "thumb1"
    assert not cover.exists()  # cleaned up after sending


def test_songs_without_a_cover_still_upload(tmp_path):
    song = tmp_path / "Plain.mp3"
    song.write_bytes(b"x" * 10)
    client = MagicMock()
    client.send_audio = AsyncMock(return_value=_message(with_thumb=False))
    with patch.object(pipeline_uploader, "extract_audio_cover", AsyncMock(return_value=None)):
        asyncio.run(upload_part_task(str(song), 1, "Plain.mp3", 0, 10, -100, None, client, is_single_part=True, file_type="audio"))
    assert client.send_audio.call_args.kwargs["thumb"] is None


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg (it is in the Docker image)")
def test_cover_is_taken_out_of_the_song(tmp_path):
    art, song = tmp_path / "art.png", tmp_path / "song.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=red:s=800x800", "-frames:v", "1", str(art)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-i", str(art), "-map", "0", "-map", "1",
                    "-c:a", "libmp3lame", "-c:v", "png", "-disposition:v", "attached_pic", str(song)], check=True)
    cover = asyncio.run(extract_audio_cover(str(song)))
    assert cover and cover.endswith(".jpg")
    import os
    assert os.path.getsize(cover) <= 200 * 1024


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg (it is in the Docker image)")
def test_song_without_art_has_no_cover(tmp_path):
    song = tmp_path / "plain.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "libmp3lame", str(song)], check=True)
    assert asyncio.run(extract_audio_cover(str(song))) is None
