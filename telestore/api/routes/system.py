# telestore/api/routes/system.py

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from telestore.security.credentials import require_auth, require_owner, User
from telestore.services import server_settings
from d4rk.Logs import setup_logger

logger = setup_logger("system_routes")

# Create router with updated prefix
router = APIRouter(prefix="/system", tags=["System"])

class ServerSettingsUpdate(BaseModel):
    archives_enabled: bool | None = None
    cloud_enabled: bool | None = None


@router.get("/settings")
async def get_server_settings(user: User = Depends(require_owner)):
    """Settings › Server (owner only)."""
    return server_settings.get()


@router.put("/settings")
async def update_server_settings(body: ServerSettingsUpdate, user: User = Depends(require_owner)):
    return server_settings.update(**body.model_dump(exclude_none=True))


@router.get("/workloads")
async def get_workloads(request: Request, user: User = Depends(require_auth)):
    """Current workload of each Telegram bot in the pool (busiest first)."""
    manager = getattr(request.app.state, "bot_manager", None)
    loads = {}
    for index, entry in enumerate(getattr(manager, "work_load", None) or []):
        for client, tracked in entry.items():
            name = getattr(client, "name", None) or f"bot{index + 1}"
            loads[name] = client.get_workload() if hasattr(client, "get_workload") else tracked
    return {
        "bots_count": len(loads),
        "loads": dict(sorted(loads.items(), key=lambda item: item[1], reverse=True)),
    }

# (The old GitHub auto-update webhook is gone: no GitHub hook pointed at it, and it ran
# `git pull` / `pip install` on any signed push. Updates are deployed as Docker images.)


class AppCrashReport(BaseModel):
    report: str = Field(..., max_length=20000)
    version: str = Field("", max_length=40)
    device: str = Field("", max_length=120)


@router.post("/app-crash")
async def report_app_crash(body: AppCrashReport, user: User = Depends(require_auth)):
    """The Android app sends what made it close unexpectedly (on its next start), so it can be fixed."""
    logger.warning(f"[APP_CRASH] user={user.username} version={body.version} device={body.device}\n{body.report}")
    return {"received": True}
