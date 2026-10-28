# telestore/api/routes/files/manage.py

from fastapi import Request, Depends, HTTPException
from pydantic import BaseModel
from bson import ObjectId
import datetime
import re
from typing import Optional
from collections import defaultdict

from telestore.security.credentials import require_auth, User
from telestore.api.routes.folders import validate_folder_name
from telestore.db import database

# For thumbnail route
from pyrogram import Client

from telestore.api.routes.files.common import logger, router

class MoveFileRequest(BaseModel):
    file_id: str
    target_path: str

class CopyFileRequest(BaseModel):
    file_id: str
    target_path: str

class DeleteFileRequest(BaseModel):
    file_id: str

class RenameFileRequest(BaseModel):
    file_id: str
    new_name: str

class StarRequest(BaseModel):
    file_id: str
    starred: Optional[bool] = None

class TrashRequest(BaseModel):
    file_id: str


def _check_protection(doc: Optional[dict], user: User) -> None:
    """423 when [doc] is protected, sits in a protected folder or holds something protected:
    those can't be deleted until their protection is removed (no password unlocks a delete)."""
    from telestore.api.routes.files.protection import locked, owner_ids
    from telestore.services import protection_service as protection
    try:
        protection.refuse(doc, owner_ids(user))
    except protection.ProtectedError as e:
        raise locked(str(e))

@router.post("/move")
async def move_file_route(request: MoveFileRequest, user: User = Depends(require_auth)):
    try:
        # Use the user's Telegram ID as the user identifier
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        # Check if user owns the file
        if not database.Files.check_file_owner(request.file_id, user_id):
            raise HTTPException(status_code=403, detail="Access denied")
            
        # Get the file by ID
        file_data = database.Files.find_one({"_id": ObjectId(request.file_id)})
        if not file_data:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Items in Trash stay where they were deleted from, so Restore can put them back
        if file_data.get("trashed"):
            raise HTTPException(status_code=400, detail="Items in Trash can't be moved. Restore it first, then move it.")
        if database.Files.is_trashed_folder_path(request.target_path, user_id):
            raise HTTPException(status_code=400, detail="That folder is in Trash. Restore it first, then move items into it.")

        # Update the file's path and modified date
        is_target_vault = request.target_path.startswith("/Vault") or request.target_path == "Vault"
        update_fields = {
            "file_path": request.target_path,
            "is_vault": is_target_vault,
            "modified_date": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        database.Files.update_one(
            {"_id": ObjectId(request.file_id), "owner_id": user_id},
            {"$set": update_fields}
        )
        
        # If moving a folder, update all descendant items file_path and is_vault
        if file_data.get("file_type") == "folder":
            old_parent = file_data.get('file_path', '').rstrip('/')
            folder_name = file_data.get('file_name', '')
            old_full_path = f"{old_parent}/{folder_name}" if old_parent else f"/{folder_name}"
            new_parent = request.target_path.rstrip('/')
            new_full_path = f"{new_parent}/{folder_name}" if new_parent else f"/{folder_name}"
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

            # 1. Update direct children
            database.Files.update_many(
                {"file_path": old_full_path, "owner_id": user_id},
                {"$set": {
                    "file_path": new_full_path,
                    "is_vault": is_target_vault,
                    "modified_date": now_iso
                }}
            )

            # 2. Update nested descendants
            database.Files.update_many(
                {"file_path": {"$regex": f"^{re.escape(old_full_path)}/"}, "owner_id": user_id},
                [{"$set": {
                    "file_path": {
                        "$replaceOne": {
                            "input": "$file_path",
                            "find": old_full_path,
                            "replacement": new_full_path
                        }
                    },
                    "is_vault": is_target_vault,
                    "modified_date": now_iso
                }}]
            )
        
        return {"message": "File moved successfully"}
    except HTTPException:
        raise  # refusals (not yours, not found, in Trash) keep their own status and message
    except Exception as e:
        logger.error(f"Error moving file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/copy")
async def copy_file_route(request: CopyFileRequest, user: User = Depends(require_auth)):
    try:
        # Use the user's Telegram ID as the user identifier
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        # Check if user owns the file
        if not database.Files.check_file_owner(request.file_id, user_id):
            raise HTTPException(status_code=403, detail="Access denied")
            
        # Get the file by ID
        file_data = database.Files.find_one({"_id": ObjectId(request.file_id)})
        if not file_data:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Create a copy of the file with the new path
        new_file_data = file_data.copy()
        new_file_data["_id"] = ObjectId()  # Generate new ID
        new_file_data["file_path"] = request.target_path
        new_file_data["modified_date"] = datetime.datetime.now(datetime.timezone.utc).isoformat()  # Set new modified date for copied file
        # Preserve the owner when copying
        new_file_data["owner_id"] = user_id
        
        database.Files.insert_one(new_file_data)

        # If copying a folder, recursively duplicate all descendants with updated paths
        if file_data.get("file_type") == "folder":
            old_parent = file_data.get('file_path', '').rstrip('/')
            folder_name = file_data.get('file_name', '')
            old_full_path = f"{old_parent}/{folder_name}" if old_parent else f"/{folder_name}"
            new_parent = request.target_path.rstrip('/')
            new_full_path = f"{new_parent}/{folder_name}" if new_parent else f"/{folder_name}"
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            is_target_vault = request.target_path.startswith("/Vault") or request.target_path == "Vault"

            descendants = list(database.Files.find({
                "$or": [
                    {"file_path": old_full_path},
                    {"file_path": {"$regex": f"^{re.escape(old_full_path)}/"}}
                ],
                "owner_id": user_id
            }))
            new_descendants = []
            for desc in descendants:
                copied_desc = desc.copy()
                copied_desc["_id"] = ObjectId()
                copied_desc["owner_id"] = user_id
                copied_desc["modified_date"] = now_iso
                copied_desc["is_vault"] = is_target_vault
                if copied_desc["file_path"] == old_full_path:
                    copied_desc["file_path"] = new_full_path
                else:
                    copied_desc["file_path"] = copied_desc["file_path"].replace(old_full_path, new_full_path, 1)
                new_descendants.append(copied_desc)
            if new_descendants:
                database.Files.insert_many(new_descendants)
        
        return {"message": "File copied successfully", "new_file_id": str(new_file_data["_id"])}
    except Exception as e:
        logger.error(f"Error copying file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rename")
async def rename_file_route(request: RenameFileRequest, user: User = Depends(require_auth)):
    try:
        # Use the user's Telegram ID as the user identifier
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        
        # Check item existence and type for validation
        item_doc = database.Files.find_one({"_id": ObjectId(request.file_id)})
        if not item_doc:
            raise HTTPException(status_code=404, detail="File or folder not found")

        if item_doc.get("file_type") == "folder":
            validated_name = validate_folder_name(request.new_name)
        else:
            if any(c in request.new_name for c in ['/', '\\']):
                raise HTTPException(status_code=400, detail="Filename cannot contain '/' or '\\'")
            validated_name = request.new_name.strip()
            if not validated_name:
                raise HTTPException(status_code=400, detail="Filename cannot be empty")

        # Rename the file/folder with owner validation
        success = database.Files.rename_file(request.file_id, validated_name, user_id)
        
        if success:
            return {"message": "Item renamed successfully"}
        else:
            raise HTTPException(status_code=404, detail="File not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error renaming file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/delete")
async def delete_file_route(
    http_request: Request,
    request: DeleteFileRequest,
    user: User = Depends(require_auth)
):
    try:
        # Use the user's Telegram ID as the user identifier
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        # Check if user owns the file
        if not database.Files.check_file_owner(request.file_id, user_id):
            raise HTTPException(status_code=403, detail="Access denied")
            
        # Get the file by ID to check if it exists
        file_data = database.Files.find_one({"_id": ObjectId(request.file_id), "owner_id": user_id})
        if not file_data:
            raise HTTPException(status_code=404, detail="File not found")
        _check_protection(file_data, user)
        
        # Track Telegram messages to delete: {chat_id: set([message_id, ...])}
        messages_to_delete = defaultdict(set)

        def collect_file_messages(doc):
            if not doc:
                return
            c_id = doc.get("chat_id")
            m_id = doc.get("message_id")
            if c_id and m_id:
                messages_to_delete[c_id].add(m_id)
            for part in doc.get("parts") or []:  # every part, even if is_split is missing
                p_mid = part.get("message_id")
                if p_mid and c_id:
                    messages_to_delete[c_id].add(p_mid)

        # Check if this is a folder
        if file_data.get("file_type") == "folder":
            folder_path = (file_data.get("file_path") or "/Home").strip()
            folder_name = (file_data.get("file_name") or "").strip()
            
            # ABSOLUTE SAFETY GUARD: Never allow deleting root Home or system folders
            if folder_name.lower() in ["home", "root", "trash", "starred"] and folder_path in ["/", "/Home", "Home", ""]:
                raise HTTPException(status_code=400, detail="Root folder cannot be deleted.")
            
            # Construct the exact folder path safely
            if folder_path in ["/", ""]:
                exact_path = f"/{folder_name}"
            else:
                exact_path = f"{folder_path.rstrip('/')}/{folder_name}"
            
            # Additional safety guard: If exact_path resolves to root container, reject
            if exact_path in ["/", "/Home", "Home", "/Vault", "Vault", "/inbox", "inbox", "/Telegram Inbox", "Telegram Inbox", ""]:
                raise HTTPException(status_code=400, detail="Root folder cannot be deleted.")
            
            paths_to_delete = [exact_path]
            
            for f_path in paths_to_delete:
                # Double-check: ensure f_path is not root
                if f_path in ["/", "/Home", "Home", ""]:
                    continue
                    
                # Find all files inside to collect their Telegram messages before deleting from DB
                sub_files = database.Files.find({
                    "$or": [
                        {"file_path": f_path},
                        {"file_path": {"$regex": f"^{re.escape(f_path)}/"}}
                    ],
                    "owner_id": user_id
                })
                for sf in sub_files:
                    collect_file_messages(sf)

                # Delete all files in the folder (owned by the user)
                database.Files.delete_many({"file_path": f_path, "owner_id": user_id})
                
                # Also delete any subfolders and files inside this folder
                database.Files.delete_many({
                    "file_path": {"$regex": f"^{re.escape(f_path)}/"},
                    "owner_id": user_id
                })
        else:
            collect_file_messages(file_data)
        
        # Delete the file/folder itself from database
        result = database.Files.delete_one({"_id": ObjectId(request.file_id), "owner_id": user_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Delete Telegram message(s) from channel if any exist (but not ones a copy still uses)
        messages_to_delete = database.Files.unreferenced_messages(messages_to_delete)
        if messages_to_delete:
            try:
                bot_manager = getattr(http_request.app.state, 'bot_manager', None)
                client: Optional[Client] = bot_manager.get_least_busy_client() if (bot_manager and hasattr(bot_manager, 'get_least_busy_client')) else None
                if not client and bot_manager and hasattr(bot_manager, 'client_list') and bot_manager.client_list:
                    client = bot_manager.client_list[0]
                
                if client:
                    for c_id, m_ids in messages_to_delete.items():
                        m_list = list(m_ids)
                        # Telegram allows deleting up to 100 messages per call
                        for i in range(0, len(m_list), 100):
                            batch = m_list[i:i+100]
                            try:
                                await client.delete_messages(chat_id=c_id, message_ids=batch)
                                logger.info(f"Successfully deleted Telegram messages {batch} from chat {c_id}")
                            except Exception as tg_batch_err:
                                logger.warning(f"Failed to delete Telegram messages {batch} from chat {c_id}: {tg_batch_err}")
                else:
                    logger.warning("No Telegram client available to delete message(s)")
            except Exception as client_err:
                logger.warning(f"Error accessing bot client for Telegram message deletion: {client_err}")
        
        return {"message": "Item deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/star")
async def star_file_route(request: StarRequest, user: User = Depends(require_auth)):
    try:
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        new_starred = database.Files.toggle_star(request.file_id, user_id, request.starred)
        return {"starred": new_starred, "message": "Updated star status"}
    except Exception as e:
        logger.error(f"Error toggling star: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trash")
async def trash_file_route(request: TrashRequest, user: User = Depends(require_auth)):
    try:
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        if ObjectId.is_valid(request.file_id):
            _check_protection(database.Files.find_one({"_id": ObjectId(request.file_id), "owner_id": user_id}), user)
        success = database.Files.move_to_trash(request.file_id, user_id)
        if success:
            return {"message": "Moved to trash successfully"}
        raise HTTPException(status_code=404, detail="File or folder not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error moving to trash: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restore")
async def restore_file_route(request: TrashRequest, user: User = Depends(require_auth)):
    try:
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        success = database.Files.restore_from_trash(request.file_id, user_id)
        if success:
            return {"message": "Restored from trash successfully"}
        raise HTTPException(status_code=404, detail="File or folder not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error restoring from trash: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trash/empty")
async def empty_trash_route(http_request: Request, user: User = Depends(require_auth)):
    try:
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        from telestore.api.routes.files.protection import owner_ids
        from telestore.services import protection_service as protection
        # Protected items stay (and so do their Telegram messages)
        kept = protection.kept_in_trash(owner_ids(user))
        kept_ids = [d["_id"] for d in kept]
        trashed_items = [d for d in database.Files.find({"trashed": True, "owner_id": user_id}) if d["_id"] not in kept_ids]
        
        messages_to_delete = defaultdict(set)
        for doc in trashed_items:
            c_id = doc.get("chat_id")
            m_id = doc.get("message_id")
            if c_id and m_id:
                messages_to_delete[c_id].add(m_id)
            for part in doc.get("parts") or []:  # every part, even if is_split is missing
                p_mid = part.get("message_id")
                if p_mid and c_id:
                    messages_to_delete[c_id].add(p_mid)
        
        database.Files.delete_many({"trashed": True, "owner_id": user_id, "_id": {"$nin": kept_ids}})
        messages_to_delete = database.Files.unreferenced_messages(messages_to_delete)

        if messages_to_delete:
            try:
                bot_manager = getattr(http_request.app.state, 'bot_manager', None)
                client: Optional[Client] = bot_manager.get_least_busy_client() if (bot_manager and hasattr(bot_manager, 'get_least_busy_client')) else None
                if not client and bot_manager and hasattr(bot_manager, 'client_list') and bot_manager.client_list:
                    client = bot_manager.client_list[0]
                if client:
                    for c_id, m_ids in messages_to_delete.items():
                        m_list = list(m_ids)
                        for i in range(0, len(m_list), 100):
                            batch = m_list[i:i+100]
                            try:
                                await client.delete_messages(chat_id=c_id, message_ids=batch)
                            except Exception as tg_err:
                                logger.warning(f"Failed deleting Telegram trash batch: {tg_err}")
            except Exception as ex:
                logger.warning(f"Error accessing bot client for trash deletion: {ex}")
                
        message = f"Emptied {len(trashed_items)} items from trash"
        if kept:
            message += f"; kept {len(kept)} protected"
        return {"message": message, "kept": len(kept)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error emptying trash: {e}")
        raise HTTPException(status_code=500, detail=str(e))
