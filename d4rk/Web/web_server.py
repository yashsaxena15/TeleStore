# src/Web/web_server.py

from typing import Literal

from pyrogram import Client

from aiohttp import web
from aiohttp.web_runner import AppRunner

from d4rk.Logs import setup_logger
from d4rk.Utils import get_public_ip, check_public_ip_reachable

from d4rk.Web.web import _web_server
WEB_APP = 'http://localhost'

logger = setup_logger("WebServerManager")

class WebServerManager:
    def __init__(self,bot:Client=None) -> None:
        self._web_runner = None
        self._tcp_site = None
        self._web_port = None
        self._bot = bot

    async def setup_web_server(self, preferred_port=8443) -> AppRunner | Literal[False]:
        try:
            self._web_port = preferred_port
            logger.info(f'Starting API server on port {preferred_port}...')
            
            self._web_runner = web.AppRunner(await _web_server(self._bot))
            await self._web_runner.setup()
            self._tcp_site = web.TCPSite(self._web_runner, "0.0.0.0", preferred_port)
            await self._tcp_site.start()
            if WEB_APP:
                if 'localhost' in WEB_APP:logger.info(f"Web app is running on http://localhost:{preferred_port}")
                else:logger.info(f"Web app is running on {WEB_APP}")
            else:
                myIP = get_public_ip()
                if await check_public_ip_reachable(myIP):logger.info(f"Web app running on http://{myIP}:{preferred_port}")
                else:logger.info(f"Web app running on http://localhost:{preferred_port}")
            return self._web_runner
        except Exception as e:
            logger.error(f"Failed to setup web server: {e}")
            return False

    async def cleanup(self) -> None:
        if self._web_runner:
            await self._web_runner.cleanup()
            logger.info("Web server cleaned up")

    

