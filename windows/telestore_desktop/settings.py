"""The app's own settings (not secret): the server, speed and how many uploads run at once."""

import json
import os
from dataclasses import asdict, dataclass, fields

from telestore_desktop import DEFAULT_SERVER, paths


@dataclass
class Settings:
    server: str = DEFAULT_SERVER
    username: str = ""
    parallel: int = 2  # files or parts sent at once (each over several connections)
    speed_limit_kb: int = 0  # 0 = no cap
    last_folder: str = "/Home"
    theme: str = "system"  # system (like Windows), light or dark
    view: str = "grid"  # grid or list
    direct_open: bool = True  # open, play and download your own files straight from Telegram

    @classmethod
    def load(cls) -> "Settings":
        try:
            with open(paths.path("settings.json"), encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, ValueError):
            raw = {}
        known = {f.name for f in fields(cls)}
        s = cls(**{k: v for k, v in raw.items() if k in known})
        s.parallel = min(8, max(1, int(s.parallel or 2)))
        s.speed_limit_kb = max(0, int(s.speed_limit_kb or 0))
        s.theme = s.theme if s.theme in ("system", "light", "dark") else "system"
        s.view = s.view if s.view in ("grid", "list") else "grid"
        return s

    def save(self) -> None:
        target = paths.path("settings.json")
        with open(target + ".tmp", "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, indent=2)
        os.replace(target + ".tmp", target)
