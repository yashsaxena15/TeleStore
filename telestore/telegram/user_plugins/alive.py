# telestore/telegram/user_plugins/alive.py

import random
import asyncio

from pyrogram import Client, filters 
from pyrogram.types import Message, InputMediaPhoto , ChatPrivileges

from d4rk.Logs import setup_logger
from d4rk.Utils import new_task

from telestore.config import START_IMGS

logger = setup_logger(__name__)

@Client.on_message(filters.command('alive','.') & filters.private & filters.outgoing)
@new_task()
async def alive(client: Client, message: Message) -> None:
    await message.edit_media(media=InputMediaPhoto(random.choice(START_IMGS), caption="I am alive!"))

class ChannelCreater:
    def __init__(self,user: Client):
        self.client = user

    async def create_channel(self,channel_name: str):
        self.channel = await self.client.create_channel(channel_name, "Channel for TeleStore Bot Updates")

    async def add_members(self,user_ids: list[int]):
        return await self.client.add_chat_members(chat_id=self.channel.id, user_ids=user_ids)

    async def promote_channel_members(self,user_ids: list[int]):
        for id in user_ids:
            try:
                await self.client.promote_chat_member(
                    chat_id=self.channel.id,
                    user_id=id,
                    privileges=ChatPrivileges(
                        can_post_messages=True,
                        can_edit_messages=True,
                        can_delete_messages=True,
                        can_invite_users=True,
                        can_manage_video_chats=True,
                        can_promote_members=True,
                        can_change_info=True,
                        can_pin_messages=True
                    )
                )
            except Exception as e:
                logger.debug(f"Failed to promote member {id}: {e}")
            await asyncio.sleep(2)
