"""
D4rk Errors Module
Custom exception classes for the D4rk package
"""

from .base import D4rkError
from .bot import BotError, FloodWaitError, TokenError
from .database import DatabaseError, ConnectionError
from .config import ConfigError

__all__ = [
    'D4rkError',
    'BotError', 
    'FloodWaitError',
    'TokenError',
    'DatabaseError',
    'ConnectionError',
    'ConfigError'
]