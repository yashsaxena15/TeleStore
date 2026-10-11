"""
Base exception classes for D4rk package
"""

class D4rkError(Exception):
    """Base exception class for all D4rk package errors"""
    
    def __init__(self, message: str = None, *args):
        self.message = message
        super().__init__(message, *args)
    
    def __str__(self):
        return self.message or "An error occurred in the D4rk package"
    
    def __repr__(self):
        return f"{self.__class__.__name__}({self.message!r})"