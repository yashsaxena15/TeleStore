import sys
import signal
import asyncio

from pyrogram import Client

from d4rk.Logs import setup_logger
from d4rk.Handlers import BotManager, FontMessageMixin , LoggerBotUtil

logger = setup_logger("TGBase")

class TGBase(FontMessageMixin, BotManager, Client):
    def __init__(self, 
                api_id: int = None,
                api_hash: str = None, 
                token: str = None,
                app_name: str = None,
                plugins: dict = None,
                database_url: str = None,
                log_chat_id: int = None,
                owner_id: int = None,
                web_app_url: str = None,
                web_server_manager = None,
                rename: bool = False,
                logger_bot_util: LoggerBotUtil = None) -> None:
        
        self.api_id = api_id
        self.api_hash = api_hash
        self.token = token
        self.app_name = app_name
        self.plugins = plugins
        self.database_url = database_url
        self.log_chat_id = log_chat_id
        self.owner_id = owner_id
        self.web_app_url = web_app_url
        self.web_server_manager = web_server_manager
        self._rename = rename
        self.logger_bot_util = logger_bot_util
        self.start_message = ""
        self.start_message_id = None
        self.start_message_chat_id = None
        self._is_connected = False
        self._workload = 0  # Initialize workload counter for this client
        
        super().__init__(
            name=self.app_name,
            api_id=self.api_id,
            api_hash=self.api_hash,
            bot_token=self.token,
            plugins=self.plugins,
            in_memory=True
        )
    
    def add_workload(self, value=1):
        """
        Add workload to this client instance
        
        Args:
            value: The amount of workload to add (default: 1)
        """
        self._workload += value
        return self._workload
    
    def get_workload(self):
        """
        Get the current workload for this client
        
        Returns:
            int: Current workload value
        """
        return self._workload
    
    def reset_workload(self):
        """
        Reset the workload counter to 0
        """
        self._workload = 0
    
    def run(self):
        """Run single bot - simple blocking call"""
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        try:
            loop.run_until_complete(self._run_async())
        except KeyboardInterrupt:
            logger.info("Received interrupt signal, stopping bot...")
            loop.run_until_complete(self._stop_single_bot())

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info(f"Received signal {signum}, stopping bot...")
        sys.exit(0)

    async def _run_async(self):
        """Internal async method to run single bot"""
        await self._send_startup_message()
        await self._start_single_bot()
        try:
            while True:
                await asyncio.sleep(5)
        except Exception as e:
            logger.error(f"Error in bot operation: {e}")
        finally:
            await self._stop_single_bot()

    async def _send_startup_message(self):
        """Send startup message using logger bot if available"""
        if self.logger_bot_util and self.log_chat_id:
            try:
                logger.info("Sending startup message via logger bot...")
                await self.logger_bot_util.send_log_message(
                    chat_id=self.log_chat_id,
                    message=f"🚀 Starting bot {self.app_name}..."
                )
            except Exception as e:
                logger.error(f"Failed to send startup message: {e}")

    async def _start_single_bot(self):
        """Start this single bot instance"""
        await self.powerup(self.app_name)

    async def _stop_single_bot(self):
        """Stop this single bot instance"""
        try:
            if hasattr(self, '_is_connected') and self._is_connected:
                await self.powerdown()
                await asyncio.sleep(2)
                logger.info(f"Bot instance {self.app_name} stopped successfully")
            else:
                logger.info(f"Bot instance {self.app_name} was not running, skipping stop")
        except Exception as e:
            logger.error(f"Error stopping bot instance {self.app_name}: {e}")

__all__ = ['TGBase']