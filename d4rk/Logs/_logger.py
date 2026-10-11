# src/Log/_logger_config.py

import os
import sys
import logging

from datetime import datetime, timezone, timedelta
from logging.handlers import TimedRotatingFileHandler

try:
    import colorama
    colorama.init(strip=False, autoreset=True)
    COLORAMA_AVAILABLE = True
except ImportError:
    COLORAMA_AVAILABLE = False

def get_timezone_offset(time_zone: str = "00:00") -> timezone:
    if time_zone:
        try:
            hours, minutes = time_zone.split(':')
            if hours.startswith("-"):
                return timezone(timedelta(hours=-int(hours), minutes=-int(minutes)))
            else:
                return timezone(timedelta(hours=int(hours), minutes=int(minutes)))
        except ValueError:
            raise ValueError(f"Invalid TIME_ZONE format: {time_zone}")
    return timezone(timedelta(hours=0))

TZ = get_timezone_offset(os.getenv("TIME_ZONE", "05:30"))

class TimeZoneFormatter(logging.Formatter):

    def __init__(self, fmt, datefmt=None, use_colors=False):
        super().__init__(fmt, datefmt)
        self.use_colors = use_colors
        self.COLORS = {
            "TIME":  "\033[93m",  # Light Yellow
            "NAME": "\033[36m",  # Cyan
            "FUNC": "\033[34m",  # Blue
            "LEVEL": {
                logging.DEBUG: "\033[37m",   # White
                logging.INFO: "\033[32m",    # Green
                logging.WARNING: "\033[33m", # Yellow
                logging.ERROR: "\033[31m",   # Red
                logging.CRITICAL: "\033[41m" # Red background
            }
        }
        self.RESET = "\033[0m"
    def converter(self, timestamp):
        dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        return dt.astimezone(TZ).timetuple()

    def formatTime(self, record, datefmt=None):
        dt = datetime.fromtimestamp(record.created, tz=timezone.utc)
        time_zone_time = dt.astimezone(TZ)
        if datefmt:
            return time_zone_time.strftime(datefmt)
        else:
            return time_zone_time.strftime('%Y-%m-%d %H:%M:%S %z')
    
    def format(self, record):
        if not self.use_colors:
            return super().format(record)

        time_str = f"{self.COLORS['TIME']}{self.formatTime(record, self.datefmt)}{self.RESET}"
        name_str = f"{self.COLORS['NAME']}{record.name}{self.RESET}"
        func_str = f"{self.COLORS['FUNC']}{record.funcName}:{record.lineno}{self.RESET}"
        level_color = self.COLORS['LEVEL'].get(record.levelno, "")
        level_str = f"{level_color}{record.levelname}{self.RESET}"
        msg_str = f"{level_color}{record.getMessage()}{self.RESET}"

        return f"{time_str} - {name_str} - {func_str} - {level_str} - {msg_str}"

def setup_logger(name=__name__, log_level=logging.INFO):
    log_dir = "logs"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    logger = logging.getLogger(name)
    logger.setLevel(log_level)
    
    if logger.handlers:
        return logger
    
    time_zone_now = datetime.now(TZ)
    
    file_handler = TimedRotatingFileHandler(
        filename=os.path.join(log_dir, f"log-{time_zone_now.strftime('%Y-%m-%d')}.txt"),
        when='midnight',
        interval=1,
        backupCount=30
    )
    file_handler.setLevel(log_level)

    
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    use_colors = sys.stdout.isatty() and COLORAMA_AVAILABLE
    plain_formatter = TimeZoneFormatter(
        '%(asctime)s - %(name)s - %(funcName)s:%(lineno)d - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
        use_colors=False
    )
    formatter = TimeZoneFormatter(
        '%(asctime)s - %(name)s - %(funcName)s:%(lineno)d - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
        use_colors=use_colors
    )

    file_handler.setFormatter(plain_formatter)
    console_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    logger.propagate = False
    return logger