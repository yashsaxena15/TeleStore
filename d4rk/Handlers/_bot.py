import os
import sys
import asyncio
import traceback

from pyrogram import Client
from pyrogram.errors import FloodWait, AccessTokenExpired

from d4rk.Logs import setup_logger

logger = setup_logger("BotClient")

logs_sent = False
logs_lock = asyncio.Lock()

class BotManager(Client):
    _bot: Client = None
    _bot_info = None
    _is_connected = False
    _rename = False
    _flood_data = {}
    _loop = None
    _scheduler_thread = None
    font = 0
    sudo_users = []
    owner = None

    def create_client(self,app_name,token):
        self.app_name = app_name
        super().__init__(
            name=app_name,
            api_id=self.api_id,
            api_hash=self.api_hash,
            bot_token=token,
            plugins=self.plugins,
            in_memory=True
            )

    def _safe_async(self, coro_func):
        if self._loop:asyncio.run_coroutine_threadsafe(coro_func(), self._loop)
        else:logger.error("Event loop is not set for _safe_async")

    async def powerup(self, app_name, max_attempts=3):
        self.app_name = app_name
        for attempt in range(max_attempts):
            try:
                await super().start()
                
                self._bot_info = self.me
                self._is_connected = True
                await self.handle_restart()
                break
                
            except FloodWait as e:
                logger.error(f"FloodWait: {e.value} seconds")
                raise e
                
            except AccessTokenExpired:
                logger.error(f"Access token expired (attempt {attempt + 1})")
                break
                
            except Exception as e:
                logger.error(f"Error starting Client.Stoped !")
                logger.error(traceback.format_exc())
                break
        else:
            logger.error("Failed to start bot after all retry attempts")

    async def powerdown(self, *args):
        global logs_sent, logs_lock
        if self._rename:await super().set_bot_info(lang_code='en',name=self.app_name + " (Offline)")

        if self._is_connected:
            try:
                await super().stop()
                self._is_connected = False
                await asyncio.sleep(3)
            except Exception as e:
                logger.error(f"Error stopping bot client: {e}")
                self._is_connected = False

    async def reboot(self):
        try:
            if self._rename:await super().set_bot_info(lang_code='en',name=self.app_name + " (restarting..)")
            logger.info("Initiating APP to reboot...")
            await super().stop()
            self._is_connected = False
            await asyncio.sleep(2)
            logger.info("Restarting process...")
            os.execl(sys.executable, sys.executable, *sys.argv)
        except Exception as e:
            logger.error(f"Error during reboot: {e}")
            os.execl(sys.executable, sys.executable, *sys.argv)

    async def handle_flood_wait(self, delay):
        """Handle flood wait by notifying the bot manager to rotate tokens"""
        logger.info(f"Handling flood wait for {delay} seconds")
        pass

    async def handle_restart(self):
        if os.path.exists('restart.txt'):
            try:
                with open('restart.txt', 'r') as file:

                    data = file.read().split()
                    chat_id = int(data[0])
                    Message_id = int(data[1])
            except Exception as e:logger.error(f"Failed to send restart notification: {e}")
            try:await self.edit_message_text(chat_id=chat_id,message_id=Message_id, text="Bot restarted successfully!")          
            except:
                try:
                    await self.send_message(chat_id=chat_id, text="Bot restarted successfully!",reply_to_message_id=Message_id-1,)
                    await self.delete_messages(chat_id=chat_id,message_ids=Message_id)
                except:pass

            if os.path.exists('restart.txt'):os.remove('restart.txt')

