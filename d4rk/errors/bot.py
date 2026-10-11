"""
Bot-specific exception classes for D4rk package
"""

from .base import D4rkError

class BotError(D4rkError):
    """Base exception class for bot-related errors"""
    pass

class FloodWaitError(BotError):
    """Exception raised when Telegram API returns a flood wait error"""
    
    def __init__(self, message: str = None, wait_time: int = None):
        super().__init__(message)
        self.wait_time = wait_time
    
    def __str__(self):
        if self.wait_time:
            return f"Flood wait error: {self.message} (wait {self.wait_time} seconds)"
        return f"Flood wait error: {self.message}"

class TokenError(BotError):
    """Exception raised when there are issues with bot tokens"""
    
    def __init__(self, message: str = None, token: str = None):
        super().__init__(message)
        self.token = token
    
    def __str__(self):
        if self.token:
            return f"Token error: {self.message} (token: {self.token[:10]}...)"
        return f"Token error: {self.message}"