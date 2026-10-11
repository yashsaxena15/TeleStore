
import pyrogram.errors
from typing import List, Union

from pyrogram import Client
from pyrogram.enums import ParseMode
from pyrogram.errors import FloodWait
from pyrogram.types import Message, CallbackQuery

from d4rk.Utils._fonts import get_font
from d4rk.Utils._decorators import new_task, retry

import asyncio

reaction_queue = asyncio.Queue()
semaphore = asyncio.Semaphore(1)
worker_running = False

class FontMessageMixin(Client):

    async def send_reaction(self,chat_id:Union[int,str], message_id:int=None, story_id:int=None, emoji:Union[int,str,List[Union[int,str]]]=None, big:bool=False, add_to_recent:bool=False, *args, **kwargs):
        global worker_running
        try:return await super().send_reaction(chat_id=chat_id,message_id=message_id,story_id=story_id,emoji=emoji,big=big,add_to_recent=add_to_recent)
        except FloodWait:
            await reaction_queue.put([chat_id, message_id, story_id, emoji, big, add_to_recent])
            if not worker_running:
                worker_running = True
                asyncio.create_task(self.reaction_worker())
        

    async def reaction_worker(self) -> None:
        global worker_running
        while worker_running:
            if reaction_queue.empty():
                worker_running = False
                break
            chat_id, message_id, story_id, emoji, big, add_to_recent = await reaction_queue.get()
            async def job() -> None:
                async with semaphore:
                    try:
                        await self._send_reaction(chat_id=chat_id, message_id=message_id, story_id=story_id, emoji=emoji, big=big, add_to_recent=add_to_recent)
                    except FloodWait as e:
                        await asyncio.sleep(e.value)
                        try:await self._send_reaction(chat_id=chat_id, message_id=message_id, story_id=story_id, emoji=emoji, big=big, add_to_recent=add_to_recent)
                        except:pass
                    finally:reaction_queue.task_done()
            await asyncio.sleep(5)
            asyncio.create_task(job())
    
    async def _send_reaction(self,*args, **kwargs):
        return await super().send_reaction(*args, **kwargs)
    
    @retry()
    async def delete_message(self,chat_id:Union[int,str], message_ids:Union[int,List[int]], revoke:bool=True, wait: int = 0):
        if wait > 0: await asyncio.sleep(wait)
        await super().delete_messages(chat_id=chat_id, message_ids=message_ids, revoke=revoke)
        
    @retry()
    async def send_message(self, chat_id :Union[int, str], text :str, parse_mode=None, *args, **kwargs):
        try:return await super().send_message(chat_id=chat_id, text=get_font(text=text, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            return await self.send_message(chat_id=chat_id, text=get_font(text=text, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        
    @retry()
    async def send_photo(self, chat_id:Union[int, str], photo :str, caption :str=None, parse_mode=None, *args, **kwargs):
        try:return await super().send_photo(chat_id=chat_id, photo=photo, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            return await self.send_photo(chat_id=chat_id, photo=photo, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)

    @retry()
    async def edit_message_text(self, chat_id: Union[int, str], message_id: int, text :str, parse_mode=None, *args, **kwargs):
        return await super().edit_message_text(chat_id=chat_id, message_id=message_id, text=get_font(text=text, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)

    @retry()
    async def edit_message_caption(self, chat_id :Union[int, str], message_id : int, caption :str, parse_mode=None, *args, **kwargs):
        try:return await super().edit_message_caption(chat_id=chat_id, message_id=message_id, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            return await self.edit_message_caption(chat_id=chat_id, message_id=message_id, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)

    @retry()
    async def edit_inline_text(self, inline_message_id: int, text :str, parse_mode=None, *args, **kwargs):
        try:return await super().edit_inline_text(inline_message_id, text=get_font(text=text, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            return await self.edit_inline_text(inline_message_id, text=get_font(text=text, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)

    @retry()
    async def send_document(self, chat_id :Union[int, str], document, caption :str=None, parse_mode=None, *args, **kwargs):
        try:return await super().send_document(chat_id, document, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            return await self.send_document(chat_id, document, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)

    @retry()
    async def send_video(self, chat_id :Union[int,str], video, caption :str=None, parse_mode=None, *args, **kwargs):
        try:return await super().send_video(chat_id, video, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            return await self.send_video(chat_id, video, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)

    @retry()
    async def send_audio(self, chat_id :Union[int,str], audio, caption :str=None, parse_mode=None, *args, **kwargs):
        try:return await super().send_audio(chat_id, audio, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            return await self.send_audio(chat_id, audio, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)

    @retry()
    async def send_voice(self, chat_id :Union[int,str], voice, caption :str=None, parse_mode=None, *args, **kwargs):
        try:return await super().send_voice(chat_id, voice, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            return await self.send_voice(chat_id, voice, caption=get_font(text=caption, font=self.font), parse_mode=ParseMode.HTML, *args, **kwargs)

    @retry()
    async def send_alert(self,message:Union[Message,CallbackQuery], text :str):
        if isinstance(message, Message):
            return await message.reply(text)
        elif isinstance(message, CallbackQuery):
            return await message.answer(text, show_alert=True)