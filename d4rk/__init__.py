import asyncio
try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())
    
from .Database import db
from .Handlers import BotManager , FontMessageMixin
from .Logs import setup_logger , get_timezone_offset
from .Utils import *
from ._base import TGBase
from ._bot_manager import D4RK_BotManager
from . import errors


__version__ = "0.9.7"
__all__ = [
    "TGBase",
    "D4RK_BotManager",
    "db",
    "errors",
    "FontMessageMixin",
    "setup_logger",
    "get_timezone_offset",
    "BotManager",
]