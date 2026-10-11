"""
Database exception classes for D4rk package
"""

from .base import D4rkError

class DatabaseError(D4rkError):
    """Base exception class for database-related errors"""
    pass

class ConnectionError(DatabaseError):
    """Exception raised when database connection fails"""
    
    def __init__(self, message: str = None, host: str = None, port: int = None):
        super().__init__(message)
        self.host = host
        self.port = port
    
    def __str__(self):
        if self.host and self.port:
            return f"Database connection error: {self.message} (host: {self.host}, port: {self.port})"
        return f"Database connection error: {self.message}"