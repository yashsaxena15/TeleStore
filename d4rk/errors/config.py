"""
Configuration exception classes for D4rk package
"""

from .base import D4rkError

class ConfigError(D4rkError):
    """Base exception class for configuration-related errors"""
    
    def __init__(self, message: str = None, config_key: str = None):
        super().__init__(message)
        self.config_key = config_key
    
    def __str__(self):
        if self.config_key:
            return f"Configuration error: {self.message} (key: {self.config_key})"
        return f"Configuration error: {self.message}"