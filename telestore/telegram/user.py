
from pyrogram import Client

from d4rk.Logs import setup_logger
logger = setup_logger(__name__)

from telestore.config import API_ID, API_HASH, LOGS
from telestore.db import database



class User(Client):
    def __init__(self):
        self.session = None
        self._sign_in = False
        self.running = False
        

    async def create_client(self):
        super().__init__(
            name="Telegram-File-Server",
            api_id=API_ID,
            api_hash=API_HASH,
            session_string=self.session,
            workers=200,
            plugins={'root': 'telestore/telegram/user_plugins'},
            sleep_threshold=10,
        )
        
    async def start(self):    
        self.session = database.Settings.get('session', str, default=None)
        if self.session is None:
            return
        await self.create_client()
        await super().start()
        self.running = True
        await self.send_message(LOGS, f"{self.me.mention} is... Online")
        logger.info(f"{self.me.username} is...  Online")
            
    async def stop(self, *args):
        if self.running:
            await self.send_message(LOGS, f"{self.me.mention} is... Offline")
            logger.info(f"{self.me.username} is...  Offline")
            await super().stop()


user = User()




