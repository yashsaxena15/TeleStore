"""
Bot Manager for d4rk package - Handles single or multiple bot instances using TGBase
"""

import sys
import time
import signal
import asyncio
import threading

from typing import List
from datetime import datetime
from pyrogram.errors import FloodWait
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from d4rk._base import TGBase
from d4rk.Web import WebServerManager
from d4rk.Handlers import LoggerBotUtil
from d4rk.Logs import setup_logger, get_timezone_offset

logger = setup_logger("D4RK_BotManager")

online_bots = {} 
flood_waited_bots = {} 
startup_message_id = None
startup_message_chat_id = None


class D4RK_BotManager:
    def __init__(self, 
                 app_name: str = None,
                 api_id: int = None,
                 api_hash: str = None, 
                 tokens: List[str] = None,
                 max_bots_count: int = 4,
                 plugins: dict = None,
                 database_url: str = None,
                 database = None,
                 log_chat_id: int = None,
                 owner_id: int = None,
                 web_app_url: str = None,
                 web_server = None,
                 web_server_port: int = None,
                 rename: bool = False,
                 logger_bot_token: str = None,
                 time_zone: str = "+5:30",
                 call_back: callable = None
                 ) -> None:
        """
        Initialize the D4RK Bot Manager
        
        Args:
            api_id: Telegram API ID
            api_hash: Telegram API Hash
            tokens: List of bot tokens to use for running bots
            max_bots_count: Maximum number of bots to run concurrently
            app_name: Application name
            plugins: Plugin configuration
            database_url: Database connection URL
            log_chat_id: Chat ID for logging
            owner_id: Owner user ID
            web_app_url: Web application URL
            rename: Whether to enable renaming functionality
            logger_bot_token: Token for the logger bot (uses python-telegram-bot library)
        """
        self.api_id = api_id
        self.api_hash = api_hash
        self.tokens = tokens or []
        self.max_bots_count = max_bots_count
        self.app_name = app_name
        self.plugins = plugins
        self.max_concurrent_bots = min(max_bots_count, len(self.tokens))
        self.database_url = database_url
        self.database = database
        self.log_chat_id = log_chat_id
        self.owner_id = owner_id
        self.web_app_url = web_app_url
        self.web_app_port = web_server_port
        self._rename = rename
        self.logger_bot_token = logger_bot_token
        self.call_back = call_back
        
        
        # Additional setup
        self.TIME_ZONE = time_zone
        self.TZ = get_timezone_offset(self.TIME_ZONE)
        self.TZ_now = datetime.now(self.TZ)
        self._stop_event = threading.Event()
        
        # Bot management
        self.bot_instances = []  # Store multiple bot instances
        self.bot_instances_copy = []  # Copy for shutdown message
        # Filter out logger bot token from available tokens
        self.available_tokens = [t for t in self.tokens if t != self.logger_bot_token] if self.logger_bot_token else self.tokens.copy()
        self.flood_waited_tokens = {}  # {token: wait_until_timestamp}
        self._running = False
        self._shutdown_initiated = False
        self._bot_counter = 0
        self._main_loop = None
        self.LOGS = self.log_chat_id
        self.web_server_manager = web_server(self) if web_server else WebServerManager(self)
        self._web_runner = None
        self.web_app_btn = None
        self.logger_bot_util = None
        
        # Initialize logger bot if token is provided
        if self.logger_bot_token:
            try:
                LoggerBotUtil.set_token(self.logger_bot_token, self.web_app_url)
                self.logger_bot_util = LoggerBotUtil
                logger.info("Logger bot initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize logger bot: {e}")
        
        # Add the new attributes you requested
        self.client_list = []  # List of all bot clients
        self.work_load = []    # List of dictionaries with client work load info
        
    def add_workload(self, client, value=1):
        """
        Add workload to a specific client
        
        Args:
            client: The bot client instance
            value: The amount of workload to add (default: 1)
        """
        # Use the client's built-in workload tracking
        if hasattr(client, 'add_workload'):
            return client.add_workload(value)
        else:
            # Fallback to old method for compatibility
            # Find the client in the work_load list and update its workload
            for workload_dict in self.work_load:
                if client in workload_dict:
                    workload_dict[client] += value
                    return workload_dict[client]
            
            # If client not found in work_load, add it with the specified value
            self.work_load.append({client: value})
            
            # Also ensure client is in client_list
            if client not in self.client_list:
                self.client_list.append(client)
            return value

    def run_bots(self):
        """
        Run multiple bots with max bot count and send status updates through logger bot.
        First sends a message that logger bot started, then edits it with bot startup info.
        """
        # Set up signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        # Create and run event loop
        try:
            self._main_loop = asyncio.get_event_loop()
        except RuntimeError:
            self._main_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._main_loop)
        
        try:
            self._main_loop.run_until_complete(self._run_async())
        except KeyboardInterrupt:
            logger.info("Received interrupt signal, stopping bots...")
            self._main_loop.run_until_complete(self.stop_all_bots())

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info(f"Received signal {signum}, stopping bots...")
        # Just set the stop event and let the main loop handle the shutdown
        self._running = False
        self._stop_event.set()
        logger.info("Shutdown process initiated")
        
        # If we're in the main thread, don't exit immediately
        # Let the main loop handle the shutdown
        if threading.current_thread() is threading.main_thread():
            # Don't exit immediately, let the main loop handle the shutdown
            pass
        else:
            # If called from another thread, we can exit
            sys.exit(0)

    async def _run_async(self):
        """Internal async method to run multiple bots with max bot count"""
        global startup_message_id, startup_message_chat_id
        self._running = True
            
        # Initialize database once
        await self._initialize_database()
        
        # Setup web server
        await self._setup_webserver()
        
        # Send initial logger bot startup message
        await self._send_logger_startup_message()
        
        # Start logger bot polling if enabled
        await self._start_logger_bot_polling()

        if self.call_back:
            try:
                asyncio.create_task(self.call_back(self))
            except Exception as e:
                logger.error(f"Error in callback function: {e}")
        
        # Start flood wait monitor task
        flood_monitor_task = asyncio.create_task(self._monitor_flood_waits())
        
        # Start multiple bot instances with token rotation on flood wait
        bots_to_start = min(self.max_bots_count, len(self.available_tokens))
        started_bots = 0
        attempts = 0
        max_attempts = 20  # Increased max attempts to prevent infinite loop
        consecutive_flood_waits = 0  # Track consecutive flood waits
        max_consecutive_flood_waits = 5  # Max consecutive flood waits before breaking
        
        logger.info(f"Attempting to start {bots_to_start} bot instances...")
        
        try:
            while (started_bots < bots_to_start and 
                attempts < max_attempts and 
                (self.available_tokens or self.flood_waited_tokens) and
                consecutive_flood_waits < max_consecutive_flood_waits):
                attempts += 1
                
                # Check if we have available tokens
                if self.available_tokens:
                    token = self.available_tokens.pop(0)
                    logger.info(f"Starting bot {started_bots + 1}/{bots_to_start} with token {token[:10]}...")
                    success = await self._start_bot_instance(token)
                    if success:
                        started_bots += 1
                        consecutive_flood_waits = 0  # Reset flood wait counter
                        logger.info(f"Successfully started bot {started_bots}/{bots_to_start}")
                        # Update startup message with each new bot that comes online
                        await self._update_startup_message_with_online_bots()
                    else:
                        # If the bot failed to start, we need to decrement the bot counter
                        # since we incremented it in _start_bot_instance but the bot didn't start
                        if self._bot_counter > 0:
                            self._bot_counter -= 1
                        logger.warning(f"Failed to start bot {started_bots + 1}/{bots_to_start}")
                        consecutive_flood_waits += 1  # Increment flood wait counter
                else:
                    # No available tokens, check if any flood wait tokens have expired
                    current_time = time.time()
                    expired_tokens = []
                    for token, wait_until in self.flood_waited_tokens.items():
                        if current_time >= wait_until:
                            expired_tokens.append(token)
                    
                    # Move expired tokens back to available pool
                    for token in expired_tokens:
                        del self.flood_waited_tokens[token]
                        self.available_tokens.append(token)
                        logger.info(f"Token {token[:10]}... is no longer flood waited")
                    
                    # If we moved some tokens back, continue the loop
                    if expired_tokens:
                        consecutive_flood_waits = 0  # Reset flood wait counter
                        continue
                        
                    # Check if we have other tokens in the original tokens list that are not in flood wait
                    # This implements actual token rotation
                    fresh_token_added = False
                    for token in self.tokens:
                        if token not in self.flood_waited_tokens and token not in self.available_tokens:
                            # Check if this token is already being used by a running bot
                            token_in_use = False
                            for bot_instance in self.bot_instances:
                                if bot_instance.token == token:
                                    token_in_use = True
                                    break
                            if not token_in_use:
                                self.available_tokens.append(token)
                                fresh_token_added = True
                                logger.info(f"Added fresh token {token[:10]}... for rotation")
                                break
                    
                    # If we added a fresh token, reset flood wait counter
                    if fresh_token_added:
                        consecutive_flood_waits = 0
                    else:
                        consecutive_flood_waits += 1  # Increment flood wait counter
                    
                    # If we still don't have available tokens, wait for flood waits to expire
                    if not self.available_tokens:
                        # Find the earliest flood wait expiration time
                        if self.flood_waited_tokens:
                            earliest_expiration = min(self.flood_waited_tokens.values())
                            current_time = time.time()
                            if earliest_expiration > current_time:
                                sleep_time = earliest_expiration - current_time
                                logger.info(f"No available tokens, waiting {sleep_time:.0f} seconds for flood wait to expire")
                                # Wait for the shortest flood wait to expire (max 30 seconds)
                                await asyncio.sleep(min(sleep_time, 30))
                        else:
                            # No tokens available and no flood waits, break the loop
                            break
            
            # Log if we broke due to consecutive flood waits
            if consecutive_flood_waits >= max_consecutive_flood_waits:
                logger.warning("Maximum consecutive flood waits reached, stopping bot startup process")
            
            logger.info(f"Bot startup process completed. {len(self.bot_instances)} bot instances successfully started out of {bots_to_start} attempted")
            
            # Update final status when all bots are started
            if len(self.bot_instances) > 0:
                await self._update_startup_message_with_online_bots()
            
            # Monitor and manage bots
            while self._running and not self._stop_event.is_set():
                await self._manage_bots()
                await asyncio.sleep(5)  # Check every 5 seconds
        except Exception as e:
            logger.error(f"Error in bot management: {e}")
        finally:
            # Cancel the flood monitor task
            if flood_monitor_task and not flood_monitor_task.done():
                flood_monitor_task.cancel()
                try:
                    await flood_monitor_task
                except asyncio.CancelledError:
                    pass
            await self.stop_all_bots()

    async def _initialize_database(self):
        """Initialize database connection"""
        try:
            self.database.connect(name=self.app_name, DATABASE_URL=self.database_url)
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
    async def _setup_webserver(self):
        """Setup web server"""
        try:
            self._web_runner = await self.web_server_manager.setup_web_server(self.web_app_port)
        except Exception as e:
            logger.error(f"Failed to setup web server: {e}")

    async def _manage_bots(self):
        """Manage bots, handle flood waits, and token rotation"""
        current_time = time.time()
        
        # Check for expired flood waits
        expired_tokens = []
        for token, wait_until in self.flood_waited_tokens.items():
            if current_time >= wait_until:
                expired_tokens.append(token)
        
        # Move expired tokens back to available pool
        for token in expired_tokens:
            del self.flood_waited_tokens[token]
            self.available_tokens.append(token)
            logger.info(f"Token {token[:10]}... is no longer flood waited")
        
        # Check if we can start more bots
        while (len(self.bot_instances) < self.max_bots_count and 
               (self.available_tokens or self.flood_waited_tokens)):
            if self.available_tokens:
                # Use an available token
                token = self.available_tokens.pop(0)
                logger.info(f"Starting bot with token {token[:10]}...")
                success = await self._start_bot_instance(token)
                # If failed due to flood wait, the token is already handled in _start_bot_instance
                # If successful, the bot is already added to self.bot_instances
                if success:
                    # Update startup message with each new bot that comes online
                    await self._update_startup_message_with_online_bots()
            else:
                # No available tokens, check if any flood wait tokens have expired
                current_time = time.time()
                expired_tokens = []
                for token, wait_until in self.flood_waited_tokens.items():
                    if current_time >= wait_until:
                        expired_tokens.append(token)
                
                # Move expired tokens back to available pool
                for token in expired_tokens:
                    del self.flood_waited_tokens[token]
                    self.available_tokens.append(token)
                    logger.info(f"Token {token[:10]}... is no longer flood waited")
                
                # If we moved some tokens back, continue the loop
                if expired_tokens:
                    continue
                
                # No available tokens and no expired flood waits
                # Check if we have other tokens in the original tokens list that are not in flood wait
                fresh_token_added = False
                for token in self.tokens:
                    if token not in self.flood_waited_tokens and token not in self.available_tokens:
                        # Check if this token is already being used by a running bot
                        token_in_use = False
                        for bot_instance in self.bot_instances:
                            if bot_instance.token == token:
                                token_in_use = True
                                break
                        if not token_in_use:
                            self.available_tokens.append(token)
                            fresh_token_added = True
                            logger.info(f"Added fresh token {token[:10]}... for rotation in manage_bots")
                            break
                
                # If we still don't have available tokens, wait for flood waits to expire
                if not self.available_tokens and not fresh_token_added:
                    # Find the earliest flood wait expiration time
                    if self.flood_waited_tokens:
                        earliest_expiration = min(self.flood_waited_tokens.values())
                        current_time = time.time()
                        if earliest_expiration > current_time:
                            sleep_time = earliest_expiration - current_time
                            logger.info(f"No available tokens, waiting {sleep_time:.0f} seconds for flood wait to expire")
                            # Update message to show flood wait status
                            await self._update_startup_message_with_online_bots()
                            # Wait for the shortest flood wait to expire
                            await asyncio.sleep(min(sleep_time, 30))  # Wait max 30 seconds at a time
                    else:
                        # No tokens available and no flood waits, break the loop
                        break

    async def _monitor_flood_waits(self):
        """Background task to monitor flood waits and restart bots when flood wait expires"""
        try:
            while self._running and not self._stop_event.is_set():
                current_time = time.time()
                expired_tokens = []
                
                # Check for expired flood waits
                for token, wait_until in self.flood_waited_tokens.items():
                    if current_time >= wait_until:
                        expired_tokens.append(token)
                
                # Move expired tokens back to available pool
                for token in expired_tokens:
                    del self.flood_waited_tokens[token]
                    self.available_tokens.append(token)
                    logger.info(f"Token {token[:10]}... flood wait expired, added back to available tokens")
                
                # If we moved some tokens back, update the message
                if expired_tokens:
                    await self._update_startup_message_with_online_bots()
                
                # Wait before checking again
                await asyncio.sleep(10)
        except asyncio.CancelledError:
            logger.info("Flood wait monitor task cancelled")
        except Exception as e:
            logger.error(f"Error in flood wait monitor: {e}")

    async def _send_logger_startup_message(self):
        """Send initial logger bot startup message"""
        global startup_message_id, startup_message_chat_id
            
        # Only send the initial message if it hasn't been sent yet
        if startup_message_id is None and self.LOGS and self.logger_bot_util:
            try:
                # Prepare the message
                total_bots = min(self.max_bots_count, len(self.tokens))
                message_text = (f"✨ {str(self.app_name).upper()} ONLINE ✨\n\n"
                               f"🚀 Logger Bot: ✅ Active\n"
                               f"🗄️ Database: 🟢 Connected\n"
                               f"🌐 Web Server: 🔥 {self.web_app_url}\n\n"
                               f"🤖 Starting {total_bots} bots...")
                
                # Add web app button if web_app_url is available
                reply_markup = None
                if self.web_app_url:
                    keyboard = [[InlineKeyboardButton("Open Web App", url=self.web_app_url)]]
                    reply_markup = InlineKeyboardMarkup(keyboard)
                
                message = await self.logger_bot_util.send_log_message(
                    chat_id=self.LOGS, 
                    message=message_text,
                    parse_mode="HTML",
                    reply_markup=reply_markup
                )
                if message:
                    startup_message_id = message.message_id
                    startup_message_chat_id = message.chat.id
                else:
                    logger.error("Failed to send logger startup message: No message returned")
            except Exception as e:
                logger.error(f"Failed to send logger startup message: {e}")

    async def _start_logger_bot_polling(self):
        """Start logger bot polling for updates"""
        if self.logger_bot_util:
            try:
                result = await self.logger_bot_util.start_polling()
                if result:
                    logger.info("Logger bot polling started successfully")
                else:
                    logger.error("Failed to start logger bot polling")
            except Exception as e:
                logger.error(f"Failed to start logger bot polling: {e}")

    async def _update_startup_message_with_online_bots(self):
        """Update startup message with information about online bots"""
        global startup_message_id, startup_message_chat_id
        
        if startup_message_id and startup_message_chat_id and self.LOGS and self.logger_bot_util:
            try:
                # Get online bot information
                online_bot_count = len(self.bot_instances)
                total_bots_to_start = min(self.max_bots_count, len(self.tokens))
                
                # Check if all bots have been started
                all_bots_started = online_bot_count >= total_bots_to_start and total_bots_to_start > 0
                
                # Show progress
                bot_info = ""
                if online_bot_count > 0 or self.flood_waited_tokens:
                    bot_info = "\n"
                    
                    # Show online bots
                    for i, bot_instance in enumerate(self.bot_instances, 1):
                        try:
                            # Get bot info to mention it properly
                            bot_me = await bot_instance.get_me()
                            bot_name = bot_me.first_name if bot_me.first_name else "Unknown Bot"
                            bot_id = bot_me.id if bot_me.id else "Unknown"
                            
                            # Store bot info for later use during shutdown
                            bot_instance._bot_name = bot_name
                            bot_instance._bot_id = bot_id
                            
                            if i == len(self.bot_instances):
                                bot_info += f"   └─ ⚡ <a href='tg://user?id={bot_id}'>{bot_name}</a>\n"
                            else:
                                bot_info += f"   ├─ ⚡ <a href='tg://user?id={bot_id}'>{bot_name}</a>\n"
                        except Exception as e:
                            # Fallback to token-based identification if we can't get bot info
                            token_suffix = bot_instance.token[-8:] if bot_instance.token else "Unknown"
                            bot_instance._bot_name = f"Bot ...{token_suffix}"
                            bot_instance._bot_id = "Unknown"
                            if i == len(self.bot_instances):
                                bot_info += f"   └─ ⚡ Bot ...{token_suffix}\n"
                            else:
                                bot_info += f"   ├─ ⚡ Bot ...{token_suffix}\n"
                    
                    # Show flood waited bots
                    if self.flood_waited_tokens:
                        flood_info = ""
                        for i, (token, wait_until) in enumerate(self.flood_waited_tokens.items(), 1):
                            # Try to get bot name from token
                            bot_name = "Unknown Bot"
                            for bot_instance in self.bot_instances:
                                if bot_instance.token == token:
                                    bot_name = getattr(bot_instance, '_bot_name', f"Bot ...{token[-8:]}")
                                    break
                            else:
                                bot_name = f"Bot ...{token[-8:]}"
                            
                            if i == len(self.flood_waited_tokens):
                                flood_info += f"   └─ ⚠️ {bot_name}\n"
                            else:
                                flood_info += f"   ├─ ⚠️ {bot_name}\n"
                        
                        if online_bot_count > 0:
                            bot_info += flood_info
                        else:
                            bot_info = flood_info
                
                # Prepare the message with progress information
                if all_bots_started:
                    status_text = "✅ All bots started"
                else:
                    status_text = f"🤖 Bots Online: {online_bot_count}/{total_bots_to_start}"
                
                message_text = (f"✨ {str(self.app_name).upper()} ONLINE ✨\n\n"  
                               f"🚀 Logger Bot: ✅ Active\n"
                               f"🗄️ Database: 🟢 Connected\n"
                               f"🌐 Web Server: 🔥 {self.web_app_url}\n\n"
                               f"{status_text}" + bot_info)
                
                # Add web app button if web_app_url is available
                reply_markup = None
                if self.web_app_url:
                    keyboard = [[InlineKeyboardButton("Open Web App", url=self.web_app_url)]]
                    reply_markup = InlineKeyboardMarkup(keyboard)

                await self.logger_bot_util.edit_log_message(
                    chat_id=startup_message_chat_id,
                    message_id=startup_message_id,
                    message=message_text,
                    parse_mode="HTML",
                    reply_markup=reply_markup
                )
            except Exception as e:
                logger.error(f"Failed to update startup message with online bots: {e}")

    async def _start_bot_instance(self, token: str):
        """Start a bot instance with a specific token"""
        try:
            self._bot_counter += 1
            # Ensure unique bot names by using the main manager's app_name as prefix
            bot_name = f"{self.app_name}_{self._bot_counter}" if self.app_name else f"bot_{self._bot_counter}"
            
            # Create a new bot instance using TGBase
            bot_instance = TGBase(
                api_id=self.api_id,
                api_hash=self.api_hash,
                token=token,
                app_name=bot_name,
                owner_id=self.owner_id,
                plugins=self.plugins,
                database_url=self.database_url,
                log_chat_id=self.log_chat_id,
                rename=self._rename,
                logger_bot_util=self.logger_bot_util  # Pass logger bot util to each bot
            )
            
            # Mark this as a bot instance to prevent it from trying to manage other bots
            bot_instance._is_bot_instance = True
            
            # Start the bot instance
            await bot_instance._start_single_bot()
            
            # Store bot reference
            self.bot_instances.append(bot_instance)
            
            # Add the client to the client_list and initialize work load
            # The bot_instance itself is the Pyrogram client (inherits from Client)
            self.client_list.append(bot_instance)
            # Initialize work load for this client with 0 tasks
            self.work_load.append({bot_instance: 0})
            
            # Only log success after the bot is actually started
            logger.info(f"Started bot instance {bot_name} with token {token[:10]}...")
            
            # Small delay to ensure the update is visible
            await asyncio.sleep(0.5)
            
            # Return True to indicate that the bot was started successfully
            return True
            
        except FloodWait as e:
            logger.error(f"FloodWait encountered for token {token[:10]}: {e.value} seconds")
            # Add token to flood waited tokens
            self.flood_waited_tokens[token] = time.time() + e.value
            logger.info(f"Token {token[:10]} added to flood wait list, will retry later")
            
            # Update message to show flood wait status
            await self._update_startup_message_with_online_bots()
            
            # Return False to indicate that the bot was not started
            return False
            
        except Exception as e:
            logger.error(f"Failed to start bot instance with token {token[:10]}...: {e}")
            # Return False to indicate that the bot was not started
            return False

    async def stop_all_bots(self):
        """Stop all bot instances gracefully"""
        global startup_message_id, startup_message_chat_id, online_bots, flood_waited_bots
        
        # Check if already stopping to prevent duplicate calls
        if not getattr(self, '_shutdown_initiated', False):
            logger.info("Stopping all bot instances...")
            self._shutdown_initiated = True
        else:
            logger.info("Bot shutdown already initiated, skipping...")
            return
            
        self._running = False
        self._stop_event.set()
        
        # Stop logger bot polling
        if self.logger_bot_util:
            try:
                await self.logger_bot_util.stop_polling()
                logger.info("Logger bot polling stopped")
            except Exception as e:
                logger.error(f"Failed to stop logger bot polling: {e}")
        
        # Edit startup message to show shutdown in progress with 🔄 emoji for stopping bots
        if startup_message_id and startup_message_chat_id and self.LOGS and self.logger_bot_util:
            try:
                # Create bot info with 🔄 emoji for stopping bots using saved information
                bot_info = ""
                if len(self.bot_instances) > 0 or self.flood_waited_tokens:
                    bot_info = "\n"
                    
                    # Show online bots
                    for i, bot_instance in enumerate(self.bot_instances, 1):
                        # Use saved bot info from when the bot was running
                        bot_name = getattr(bot_instance, '_bot_name', f"Bot ...{bot_instance.token[-8:] if bot_instance.token else 'Unknown'}")
                        bot_id = getattr(bot_instance, '_bot_id', 'Unknown')
                        if i == len(self.bot_instances):
                            bot_info += f"   └─ 🔄 <a href='tg://user?id={bot_id}'>{bot_name}</a>\n"
                        else:
                            bot_info += f"   ├─ 🔄 <a href='tg://user?id={bot_id}'>{bot_name}</a>\n"
                    
                    # Show flood waited bots
                    if self.flood_waited_tokens:
                        flood_info = ""
                        for i, (token, wait_until) in enumerate(self.flood_waited_tokens.items(), 1):
                            # Try to get bot name from token
                            bot_name = "Unknown Bot"
                            for bot_instance in self.bot_instances:
                                if bot_instance.token == token:
                                    bot_name = getattr(bot_instance, '_bot_name', f"Bot ...{token[-8:]}")
                                    break
                            else:
                                bot_name = f"Bot ...{token[-8:]}"
                            
                            if i == len(self.flood_waited_tokens):
                                flood_info += f"   └─ ⚠️ {bot_name}\n"
                            else:
                                flood_info += f"   ├─ ⚠️ {bot_name}\n"
                        
                        if len(self.bot_instances) > 0:
                            bot_info += flood_info
                        else:
                            bot_info = flood_info
                
                # Prepare the message
                total_bots = len(self.bot_instances) + len(self.flood_waited_tokens)
                message_text = (f"✨ {str(self.app_name).upper()} ONLINE ✨\n\n"
                               f"🚀 Logger Bot: ✅ Active\n"
                               f"🗄️ Database: 🟢 Connected\n"
                               f"🌐 Web Server: 🔥 Stopping \n\n"
                               f"🤖 Stopping Bots: {total_bots}" + bot_info)
                
                # Add web app button if web_app_url is available
                reply_markup = None
                if self.web_app_url:
                    keyboard = [[InlineKeyboardButton("Open Web App", url=self.web_app_url)]]
                    reply_markup = InlineKeyboardMarkup(keyboard)
                
                await self.logger_bot_util.edit_log_message(
                    chat_id=startup_message_chat_id,
                    message_id=startup_message_id,
                    message=message_text,
                    parse_mode="HTML",
                    reply_markup=reply_markup
                )
            except Exception as e:
                logger.error(f"Failed to update shutdown progress message: {e}")
        
        # Stop all bot instances
        stop_tasks = []
        for bot_instance in self.bot_instances:
            try:
                stop_tasks.append(bot_instance._stop_single_bot())
            except Exception as e:
                logger.error(f"Error preparing to stop bot instance: {e}")
        
        # Wait for all bot instances to stop
        if stop_tasks:
            try:
                await asyncio.gather(*stop_tasks, return_exceptions=True)
            except Exception as e:
                logger.error(f"Error while stopping bot instances: {e}")
        
        # Store the bot count and copy of bot instances before clearing the list
        stopped_bot_count = len(self.bot_instances)
        flood_waited_count = len(self.flood_waited_tokens)
        # Create a copy of the bot instances list before clearing it
        self.bot_instances_copy = self.bot_instances.copy()
        self.bot_instances.clear()
        
        # Clear the client_list and work_load as well
        self.client_list.clear()
        self.work_load.clear()
        
        # Edit startup message to show successful shutdown with 🛑 emoji for stopped bots
        if startup_message_id and startup_message_chat_id and self.LOGS and self.logger_bot_util:
            try:
                # Create bot info with 🛑 emoji for stopped bots using saved information
                bot_info = ""
                if stopped_bot_count > 0 or flood_waited_count > 0:
                    bot_info = "\n"
                    
                    # Show stopped bots
                    for i, bot_instance in enumerate(self.bot_instances_copy, 1):
                        # Use saved bot info from when the bot was running
                        bot_name = getattr(bot_instance, '_bot_name', f"Bot ...{bot_instance.token[-8:] if bot_instance.token else 'Unknown'}")
                        bot_id = getattr(bot_instance, '_bot_id', 'Unknown')
                        if i == len(self.bot_instances_copy):
                            bot_info += f"   └─ 🛑 <a href='tg://user?id={bot_id}'>{bot_name}</a>\n"
                        else:
                            bot_info += f"   ├─ 🛑 <a href='tg://user?id={bot_id}'>{bot_name}</a>\n"
                    
                    # Show flood waited bots that couldn't be started
                    if flood_waited_count > 0:
                        flood_info = ""
                        for i, (token, wait_until) in enumerate(self.flood_waited_tokens.items(), 1):
                            # Try to get bot name from token
                            bot_name = "Unknown Bot"
                            for bot_instance in self.bot_instances_copy:
                                if bot_instance.token == token:
                                    bot_name = getattr(bot_instance, '_bot_name', f"Bot ...{token[-8:]}")
                                    break
                            else:
                                bot_name = f"Bot ...{token[-8:]}"
                            
                            if i == flood_waited_count:
                                flood_info += f"   └─ ⚠️ {bot_name}\n"
                            else:
                                flood_info += f"   ├─ ⚠️ {bot_name}\n"
                        
                        if stopped_bot_count > 0:
                            bot_info += flood_info
                        else:
                            bot_info = flood_info
                 
                # Prepare the message
                message_text = (f"✨ {self.app_name} OFFLINE ✨\n\n"
                               f"🚀 Logger Bot: 📛 Deactivated\n"
                               f"🗄️ Database: 📛 Disonnected\n"
                               f"🌐 Web Server: ⏸️ Stopped\n\n"
                               f"🤖 All Bots: {stopped_bot_count + flood_waited_count}" + bot_info)
                
                # Add web app button if web_app_url is available
                reply_markup = None
                await self.logger_bot_util.edit_log_message(
                    chat_id=startup_message_chat_id,
                    message_id=startup_message_id,
                    message=message_text,
                    parse_mode="HTML",
                    reply_markup=reply_markup
                )
            except Exception as e:
                logger.error(f"Failed to update successful shutdown message: {e}")
        
        # Clear global tracking variables
        startup_message_id = None
        startup_message_chat_id = None
        
        logger.info("All bot instances stopped successfully")

    def update_work_load(self, client, tasks_count):
        """Update the work load for a specific client"""
        # Find the client in the work_load list and update its task count
        for i, work_item in enumerate(self.work_load):
            if client in work_item:
                self.work_load[i][client] = tasks_count
                return
        # If client not found, add it to the work_load list
        self.work_load.append({client: tasks_count})

    def get_client_count(self):
        """Get the number of clients"""
        return len(self.client_list)

    def get_least_busy_client(self):
        """Get the client with the least workload"""
        if not self.client_list:
            return None
            
        # Try to get the client with the least workload using client-based tracking
        try:
            # Find the client with minimum workload
            least_busy_client = min(self.client_list, key=lambda client: client.get_workload() if hasattr(client, 'get_workload') else 0)
            return least_busy_client
        except Exception:
            # Fallback to first client if there's an error
            return self.client_list[0] if self.client_list else None

    def has_logger_bot(self):
        """Check if logger bot is available"""
        return self.logger_bot_util is not None

    def get_logger_bot_client(self):
        """Get the logger bot client if available"""
        if not self.logger_bot_util:
            return None
            
        # For python-telegram-bot, the bot is directly accessible
        if hasattr(self.logger_bot_util, 'bot') and self.logger_bot_util.bot:
            return self.logger_bot_util.bot
            
        return None

__all__ = ['D4RK_BotManager']