"""
Utility functions for working with the logger bot
"""
import logging
import asyncio
from typing import Optional, Callable, Any, List, Dict
from telegram import Bot, Update, InlineKeyboardButton, InlineKeyboardMarkup , WebAppInfo
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

logger = logging.getLogger(__name__)

# Default start message
DEFAULT_START_MESSAGE = "👋 Hello! I'm the logger bot.\n\nI'm currently running and monitoring the system.\n\nAvailable commands:\n/start - Show this message\n/status - Check bot status\n/echo <message> - Echo a message"

class LoggerBotUtil:
    """Utility class for logger bot operations"""
    bot: Optional[Bot] = None  # class-level bot instance
    application: Optional[Application] = None  # application for polling
    polling_task: Optional[asyncio.Task] = None  # task for running polling
    start_message = None
    start_message_id = None
    start_message_chat_id = None
    update_handlers = []  # store registered update handlers
    web_app = None

    @classmethod
    def set_token(cls, token: str,web_app: None):
        """Initialize the bot with the given token"""
        try:
            cls.bot = Bot(token=token)
            cls.web_app = web_app
            # Initialize application for polling
            cls.application = Application.builder().token(token).build()
            
            # Add default command handlers
            cls.application.add_handler(CommandHandler("start", cls._start_command))
            cls.application.add_handler(CommandHandler("status", cls._status_command))
            cls.application.add_handler(CommandHandler("echo", cls._echo_command))
            
            logger.info(f"Logger bot initialized successfully with token {token[:10]}...")
        except ImportError as e:
            logger.warning("python-telegram-bot not installed. Logger bot functionality disabled.")
            logger.error(f"Import error: {e}")
            cls.bot = None
            cls.application = None
        except Exception as e:
            logger.error(f"Failed to initialize logger bot with token {token[:10]}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            cls.bot = None
            cls.application = None
            

    @classmethod
    async def _start_command(cls, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Default /start command handler"""
        try:
            reply_markup = None
            # if cls.web_app:
            keyboard = [[InlineKeyboardButton("Open Web App", web_app=WebAppInfo(url=cls.web_app))]]
            reply_markup = InlineKeyboardMarkup(keyboard)
            await update.message.reply_text(DEFAULT_START_MESSAGE, reply_markup=reply_markup)
        except Exception as e:
            logger.error(f"Failed to send start command response: {e}")

    @classmethod
    async def _status_command(cls, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Default /status command handler"""
        try:
            # Get basic status information
            status_message = "📊 Logger Bot Status\n\n"
            status_message += "✅ Bot is running\n"
            status_message += f"🕐 Uptime: Online\n"
            status_message += f"🔄 Polling: Active\n"
            status_message += f"📬 Handlers: {len(cls.update_handlers) + 3} registered\n"  # +3 for default handlers
            
            await update.message.reply_text(status_message)
        except Exception as e:
            logger.error(f"Failed to send status command response: {e}")
            try:
                await update.message.reply_text("❌ Error retrieving status information")
            except:
                pass

    @classmethod
    async def _echo_command(cls, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Default /echo command handler"""
        try:
            if context.args:
                message = " ".join(context.args)
                await update.message.reply_text(f"Echo: {message}")
            else:
                await update.message.reply_text("Usage: /echo <message>")
        except Exception as e:
            logger.error(f"Failed to send echo command response: {e}")

    @classmethod
    def add_update_handler(cls, handler_type: str, callback: Callable[[Any, Update, Any], None], pattern: str = None):
        """Add an update handler for the logger bot polling"""
        if not cls.application:
            logger.error("Logger bot application is not initialized. Call set_token() first.")
            return False
            
        try:
            if handler_type == "command":
                handler = CommandHandler(pattern, callback)
            elif handler_type == "message":
                handler = MessageHandler(filters.TEXT & ~filters.COMMAND, callback)
            elif handler_type == "all":
                handler = MessageHandler(filters.ALL, callback)
            else:
                logger.error(f"Unsupported handler type: {handler_type}")
                return False
                
            cls.application.add_handler(handler)
            cls.update_handlers.append(handler)
            logger.info(f"Added {handler_type} handler for logger bot")
            return True
        except Exception as e:
            logger.error(f"Failed to add update handler: {e}")
            return False

    @classmethod
    async def start_polling(cls):
        """Start polling for updates"""
        if not cls.application:
            logger.error("Logger bot application is not initialized. Call set_token() first.")
            return None
        try:
            # Start the application and polling in a separate task
            cls.polling_task = asyncio.create_task(cls._run_polling_background())
            logger.info("Logger bot polling started")
            return True
        except Exception as e:
            logger.error(f"Failed to start logger bot polling: {e}")
            return None

    @classmethod
    async def _run_polling_background(cls):
        """Internal method to run the polling in the background"""
        if not cls.application:
            return
        try:
            # Use run_polling in a way that doesn't block
            await cls.application.initialize()
            await cls.application.start()
            await cls.application.updater.start_polling()
            # Keep the task alive
            while cls.application.running and cls.application.updater.running:
                await asyncio.sleep(1)
        except Exception as e:
            logger.error(f"Error in logger bot polling background task: {e}")

    @classmethod
    async def stop_polling(cls):
        """Stop polling for updates"""
        if not cls.application:
            logger.error("Logger bot application is not initialized.")
            return False
        try:
            # Stop the updater and application
            if cls.application.updater.running:
                await cls.application.updater.stop()
            if cls.application.running:
                await cls.application.stop()
            await cls.application.shutdown()
            
            # Cancel the polling task if it exists
            if cls.polling_task and not cls.polling_task.done():
                cls.polling_task.cancel()
                try:
                    await cls.polling_task
                except asyncio.CancelledError:
                    pass
                cls.polling_task = None
            
            logger.info("Logger bot polling stopped")
            return True
        except Exception as e:
            logger.error(f"Failed to stop logger bot polling: {e}")
            return False

    @classmethod
    async def send_start_message(cls, chat_id: int, message: str):
        if not cls.bot:
            logger.error("Logger bot is not initialized. Call set_token() first.")
            return None
        try:
            if cls.start_message is None:
                sent_message = await cls.bot.send_message(chat_id=chat_id, text=message)
                cls.start_message_id = sent_message.message_id
                cls.start_message_chat_id = sent_message.chat_id
            else:
                await cls.bot.edit_message_text(chat_id=cls.start_message_chat_id, message_id=cls.start_message_id, text=cls.start_message + "\n" + message)
            return True
        except Exception as e:
            logger.error(f"Failed to send log message: {e}")
            return None

    @classmethod
    async def send_log_message(cls, chat_id: int, message: str, parse_mode: str = None, reply_markup: InlineKeyboardMarkup = None):
        if not cls.bot:
            logger.error("Logger bot is not initialized. Call set_token() first.")
            return None
        try:
            sent_message = await cls.bot.send_message(
                chat_id=chat_id, 
                text=message, 
                parse_mode=parse_mode,
                reply_markup=reply_markup
            )
            return sent_message
        except Exception as e:
            logger.error(f"Failed to send log message: {e}")
            return None
    
    @classmethod
    async def edit_log_message(cls, chat_id: int, message_id: int, message: str, parse_mode: str = 'HTML', reply_markup: InlineKeyboardMarkup = None) -> bool:
        if not cls.bot:
            logger.error("Logger bot is not initialized. Call set_token() first.")
            return False
        try:
            await cls.bot.edit_message_text(
                chat_id=chat_id, 
                message_id=message_id, 
                text=message, 
                parse_mode=parse_mode,
                reply_markup=reply_markup
            )
            return True
        except:
            return False
    
    @classmethod
    async def send_document(cls, chat_id: int, document_path: str, caption: str = None) -> bool:
        if not cls.bot:
            logger.error("Logger bot is not initialized. Call set_token() first.")
            return False
        try:
            with open(document_path, 'rb') as document:
                await cls.bot.send_document(chat_id=chat_id, document=document, caption=caption)
            return True
        except Exception as e:
            logger.error(f"Failed to send document: {e}")
            return False