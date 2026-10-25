# telestore/api/state.py

from typing import Dict
from datetime import datetime
from telestore.db import database
from d4rk.Logs import setup_logger

logger = setup_logger("web_server_utilities")

work_loads = {}
_auth_tokens: Dict[str, Dict] = {}

def load_persistent_tokens(app):
    """Load persistent auth tokens from database on startup"""
    try:
        database.Users.cleanup_expired_tokens()
        tokens_cursor = database.Users.database.AuthTokens.find({
            'expires_at': {'$gte': datetime.now()}
        })
        
        loaded_count = 0
        for token_data in tokens_cursor:
            auth_token = token_data['auth_token']
            _auth_tokens[auth_token] = {
                "authenticated": True,
                "username": token_data['username'],
                "auth_method": token_data['auth_method'],
                "created_at": token_data['created_at'].isoformat() if hasattr(token_data['created_at'], 'isoformat') else str(token_data['created_at'])
            }
            loaded_count += 1
        
    except Exception as e:
        logger.error(f"Failed to load persistent auth tokens: {e}")

# WebDAV PUTs in progress register their temp-file prefix (dav_<id>) here
active_dav_uploads: set = set()


def _in_use_prefixes() -> set:
    """Temp names in tg_files/ that belong to uploads or transfers still running."""
    prefixes = {f"dav_{upload_id}" for upload_id in active_dav_uploads}
    try:
        from telestore.api.routes.files.chunked_upload import active_upload_dirs
        prefixes |= active_upload_dirs()
    except Exception:
        pass
    try:
        from telestore.services.remote_transfer_manager import remote_transfer_manager
        prefixes |= {f"remote_{task_id}" for task_id in list(remote_transfer_manager.active_tasks)}
    except Exception:
        pass
    return prefixes


def _newest_mtime(path: str) -> float:
    """A folder's own time doesn't change while a file inside it grows; look at its files."""
    import os
    newest = os.path.getmtime(path)
    if os.path.isdir(path):
        for root, _dirs, files in os.walk(path):
            for name in files:
                try:
                    newest = max(newest, os.path.getmtime(os.path.join(root, name)))
                except OSError:
                    pass
    return newest


def cleanup_stale_upload_files(max_age_seconds: int = 3600):
    """
    Purges temporary upload directories (chunk_*) and files (dav_*, *.tmp) in tg_files/ that
    nothing has written to for max_age_seconds. Uploads and transfers still running are skipped,
    however long they take (a 5 GB upload on a slow line can run for hours).
    """
    import os
    import time
    import shutil

    tg_files_dir = os.path.join(os.getcwd(), "tg_files")
    if not os.path.exists(tg_files_dir):
        return

    now = time.time()
    in_use = _in_use_prefixes()
    try:
        for entry in os.listdir(tg_files_dir):
            entry_path = os.path.join(tg_files_dir, entry)
            if any(entry == p or entry.startswith(p + "_") for p in in_use):
                continue
            try:
                mtime = _newest_mtime(entry_path)
                if now - mtime >= max_age_seconds:
                    if os.path.isdir(entry_path):
                        shutil.rmtree(entry_path, ignore_errors=True)
                        logger.info(f"[JANITOR] Cleaned up stale upload directory: {entry}")
                    else:
                        os.remove(entry_path)
                        logger.info(f"[JANITOR] Cleaned up stale upload file: {entry}")
            except Exception as e:
                logger.warning(f"[JANITOR] Failed to clean {entry_path}: {e}")
    except Exception as e:
        logger.error(f"[JANITOR] Error during tg_files cleanup: {e}")

__all__ = ['work_loads', '_auth_tokens', 'load_persistent_tokens', 'cleanup_stale_upload_files', 'active_dav_uploads']