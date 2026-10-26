# telestore/api/app.py

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
import os
import datetime

# Set up logger to match your application's logging format
from d4rk.Logs import setup_logger
logger = setup_logger("web_server")

from telestore.api.routes.stream import router as stream_router
# Import the new Telegram verification router
from telestore.api.routes.telegram_verification import router as telegram_router

# Import our new routers
from telestore.api.routes.auth import router as auth_router
from telestore.api.routes.files import router as files_router
from telestore.api.routes.folders import router as folders_router
from telestore.api.routes.system import router as system_router
from telestore.api.routes.user import router as user_router
from telestore.api.routes.media import router as media_router
from telestore.api.routes.archive import router as archive_router
from telestore.api.routes.vault import router as vault_router
from telestore.api.routes.remote_transfer import router as remote_transfer_router
from telestore.api.routes.cloud import router as cloud_router
from telestore.api.routes.worker import router as worker_router
from telestore.api.routes.frontend import router as frontend_router
from telestore.api.routes.webdav import router as webdav_router
# Import exception handlers
from telestore.api.routes.error_handlers import exception_handlers

from telestore.config import API_DOCS_ENABLED, APP_NAME, OWNER, SESSION_SECRET_KEY, FRONTEND_DIST
from telestore.db import database

# Import utility functions and global variables
from telestore.api.state import _auth_tokens, cached_token, cached_token_valid, load_persistent_tokens, cleanup_stale_upload_files

app = FastAPI(
    docs_url="/docs" if API_DOCS_ENABLED else None,
    redoc_url="/redoc" if API_DOCS_ENABLED else None,
    openapi_url="/openapi.json" if API_DOCS_ENABLED else None,
    title=f"{APP_NAME} Media Server",
    description=f"A powerful, self-hosted {APP_NAME} built with FastAPI, MongoDB, and PyroFork seamlessly integrated with Stremio for automated media streaming and discovery.",
)

# Load persistent tokens on startup
@app.on_event("startup")
async def startup_event():
    load_persistent_tokens(app)

    try:
        fixed = database.Files.mark_split_files()
        if fixed:
            logger.info(f"Marked {fixed} multi-part file(s) that were saved without is_split")
    except Exception as e:
        logger.warning(f"Couldn't check multi-part files: {e}")
    
    # Run startup cleanup for any stale upload files (> 5 minutes old from previous crashes)
    cleanup_stale_upload_files(max_age_seconds=300)

    # Start periodic janitor background task (runs every 15 minutes)
    import asyncio
    async def periodic_upload_janitor():
        while True:
            await asyncio.sleep(900)  # 15 minutes
            try:
                # Deleting multi-GB files blocks; keep it off the event loop
                await asyncio.to_thread(cleanup_stale_upload_files, 3600)
            except Exception as e:
                logger.error(f"Error in periodic_upload_janitor: {e}")

    asyncio.create_task(periodic_upload_janitor())

    # Ensure admin user has telegram_user_id set to match OWNER env var
    if OWNER is not None:
        try:
            admin_user = database.Users.getUser("admin")
            if not admin_user or admin_user.get("telegram_user_id") != OWNER:
                # Update admin user with OWNER Telegram ID
                telegram_data = {
                    "telegram_user_id": OWNER
                }
                success = database.Users.update_telegram_info("admin", telegram_data)
                if success:
                    logger.info(f"Updated admin user with OWNER Telegram ID: {OWNER}")
                else:
                    logger.error("Failed to update admin user with OWNER Telegram ID")
        except Exception as e:
            logger.error(f"Error ensuring admin user has correct Telegram ID: {e}")


# --- Middleware Setup ---
# Configure session middleware to work with both browsers and Tauri WebView
# For localhost development, we need to handle cookies properly
app.add_middleware(
    SessionMiddleware, 
    secret_key=SESSION_SECRET_KEY,
    same_site="lax",     # Use lax for better compatibility with browsers in development
    https_only=False,     # Allow non-HTTPS for localhost and IP deployments
    max_age=3600,         # 1 hour session timeout
    path="/",             # Explicitly set cookie path
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:8081", "tauri://localhost", "http://localhost:5173", "http://localhost:9000", "http://127.0.0.1:9000"],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Add auth token middleware for Tauri/desktop app support ---
@app.middleware("http")
async def auth_token_middleware(request: Request, call_next):
    """Handle token-based authentication for Tauri/desktop apps and browser downloads"""
    auth_header = request.headers.get("X-Auth-Token")
    if not auth_header:
        # Also check query param 'token' for direct browser downloads or media streaming
        auth_header = request.query_params.get("token")
    if auth_header:
        # First check in-memory cache (an expired token is dropped there)
        if cached_token_valid(auth_header):
            token_data = _auth_tokens[auth_header]
            # Add token data to session-like storage for the route handlers
            request.state.auth_token_data = token_data
            request.state.authenticated_via_token = True
        else:
            # Check in database if not found in memory
            db_token_data = database.Users.get_auth_token(auth_header)
            if db_token_data:
                # Add to in-memory cache for future requests
                _auth_tokens[auth_header] = cached_token(db_token_data)
                # Add token data to session-like storage for the route handlers
                request.state.auth_token_data = _auth_tokens[auth_header]
                request.state.authenticated_via_token = True
    response = await call_next(request)
    return response

# Include our new routers with updated prefixes
app.include_router(auth_router)
app.include_router(files_router)
app.include_router(folders_router)
app.include_router(system_router)
app.include_router(user_router)
app.include_router(stream_router)
app.include_router(media_router)
app.include_router(archive_router)
app.include_router(archive_router, prefix="/api")
app.include_router(telegram_router)
app.include_router(webdav_router)
app.include_router(vault_router)
app.include_router(vault_router, prefix="/api")
app.include_router(remote_transfer_router)
app.include_router(remote_transfer_router, prefix="/api")
app.include_router(cloud_router)
app.include_router(cloud_router, prefix="/api")
app.include_router(worker_router)
# Built frontend assets. The folder is absent until `npm run build` (e.g. in CI or a
# fresh checkout), so check_dir=False lets the API start without it.
app.mount(
    "/assets",
    StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets"), check_dir=False),
    name="assets",
)
# Register exception handlers
for exc_class, handler in exception_handlers.items():
    app.add_exception_handler(exc_class, handler)

# --- Add logging middleware ---
_SENSITIVE_QUERY_KEYS = {"token", "auth_token", "access_token", "key", "password", "code"}

def _redact_url(url) -> str:
    """Hide credential-like query parameter values in logged URLs."""
    if not url.query:
        return str(url)
    from urllib.parse import parse_qsl, urlencode
    params = [(k, "***" if k.lower() in _SENSITIVE_QUERY_KEYS else v) for k, v in parse_qsl(url.query, keep_blank_values=True)]
    return str(url.replace(query=urlencode(params)))

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all HTTP requests using your application's logger"""
    logger.info(f"{request.method} {_redact_url(request.url)}")
    try:
        response = await call_next(request)
        logger.info(f"Response status: {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"Request failed with error: {e}")
        raise

@app.get("/api")
async def root():
    return {
        "app": f"{APP_NAME} Media Server",
        "version": "1.0.0",
        "status": "running",
    }

# Add a health check endpoint
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.datetime.now().isoformat()}

@app.options("/api/health")
async def health_check_options():
    return {"status": "ok"}

# Frontend SPA router must be registered last to avoid shadowing API routes
app.include_router(frontend_router)


async def _web_server(bot_manager):
    app.state.bot_manager = bot_manager
    from telestore.services.remote_transfer_manager import remote_transfer_manager
    remote_transfer_manager.start_worker(app)
    return app