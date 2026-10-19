# telestore/api/routes/files/common.py

from fastapi import APIRouter

from d4rk.Logs import setup_logger

# For thumbnail route


logger = setup_logger("files_routes")

# Create router with updated prefix
router = APIRouter(prefix="/files", tags=["Files"])

# Global variable for auth tokens (should be imported from main app)
_auth_tokens = {}
