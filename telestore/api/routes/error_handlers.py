# telestore/api/routes/error_handlers.py

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

# Define exception handlers as functions that can be registered on the main app
async def unauthorized_handler(request: Request, exc):
    headers = dict(getattr(exc, "headers", None) or {})
    if request.url.path.startswith("/webdav"):
        headers.setdefault("WWW-Authenticate", 'Basic realm="TeleStore WebDAV"')
    return JSONResponse(
        status_code=401,
        content={"detail": getattr(exc, "detail", "Authentication required")},
        headers=headers if headers else None
    )

async def not_found_handler(request: Request, exc):
    return JSONResponse(
        status_code=404,
        content={"detail": "Resource not found"}
    )

async def internal_error_handler(request: Request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )

async def validation_exception_handler(request: Request, exc):
    return JSONResponse(
        status_code=422,
        content={"detail": "Validation error", "errors": exc.errors()}
    )

async def http_exception_handler(request: Request, exc):
    # Keep headers such as Retry-After (sign-in and PIN lockouts) and WWW-Authenticate
    headers = getattr(exc, "headers", None)
    detail = exc.detail
    if exc.status_code >= 500:
        # Server errors keep their details in the log: they can hold paths, database errors or
        # addresses that are nobody else's business. 502-504 carry plain "Telegram or a service is unavailable" messages.
        logging.getLogger("telestore.errors").error(f"{request.method} {request.url.path} -> {exc.status_code}: {detail}")
        if exc.status_code not in (502, 503, 504):
            detail = "Something went wrong on the server. Try again; if it keeps happening, tell the owner."
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail},
        headers=dict(headers) if headers else None
    )

# Export handlers for registration on main app
exception_handlers = {
    401: unauthorized_handler,
    404: not_found_handler,
    500: internal_error_handler,
    RequestValidationError: validation_exception_handler,
    StarletteHTTPException: http_exception_handler,
}