# src/Web/web.py

import asyncio

from datetime import datetime

from pyrogram import Client


from aiohttp import web
from aiohttp.web_app import Application
from aiohttp.web_response import Response

from d4rk.Logs import setup_logger

logger = setup_logger(__name__)
routes = web.RouteTableDef()
bot:Client = None
bot_process = None


@routes.get("/logs")
async def logs_ui(request):
    """
    Serve a pretty terminal-like log UI for the bot using SSE.
    """
    try:
        resp = web.StreamResponse(
            status=200,
            reason='OK',
            headers={
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
            }
        )
        await resp.prepare(request)

        html = b"""
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Serandip Bot Logs</title>
<style>
    /* Fullscreen background */
    body {
        margin: 0;
        padding: 0;
        height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
        background: radial-gradient(circle at top, #0d0d0d, #1a1a1a);
        font-family: 'Fira Code', monospace;
        color: #00ff00;
        overflow: hidden;
    }

    /* Terminal container */
    #terminal {
        width: 90%;
        height: 70%;
        background: rgba(0, 0, 0, 0.85);
        border-radius: 10px;
        padding: 20px;
        margin-bottom: 30px
        overflow-y: auto;
        box-shadow: 0 0 40px rgba(0, 255, 0, 0.5);
        border: 2px solid rgba(0, 255, 0, 0.4);
        backdrop-filter: blur(5px);
    }

    #logs {
        white-space: pre-wrap;
        line-height: 1.3em;
    }

    /* Title */
    h2 {
        text-align: center;
        margin-bottom: 10px;
        font-weight: normal;
        color: #00ff00;
        text-shadow: 0 0 5px #00ff00, 0 0 10px #00ff00;
    }

    /* Blinking cursor */
    #cursor {
        display: inline-block;
        width: 10px;
        background-color: #00ff00;
        animation: blink 1s infinite;
        margin-left: 2px;
    }

    @keyframes blink {
        0%, 50% { opacity: 1; }
        50.1%, 100% { opacity: 0; }
    }
</style>
</head>
<body>
<div id="terminal">
    <h2>Serandip Bot Logs</h2>
    <div id="logs"></div>
    <span id="cursor"></span>
</div>

<script src="https://cdn.jsdelivr.net/npm/ansi_up@5.0.0/ansi_up.min.js"></script>
<script>
    const logsDiv = document.getElementById("logs");
    const cursor = document.getElementById("cursor");
    const ansi_up = new AnsiUp;

    const evtSource = new EventSource("/logs_stream");
    evtSource.onmessage = e => {
        logsDiv.innerHTML += ansi_up.ansi_to_html(e.data) + "<br>";
        logsDiv.scrollTop = logsDiv.scrollHeight;
    };
</script>
</body>
</html>
"""

        await resp.write(html)
        await resp.write_eof()
        return resp
    except Exception as e:
        logger.error(f"Error in logs_ui route: {e}")
        return web.Response(text="An error occurred while processing your request.", status=500)

@routes.get("/logs_stream")
async def terminal_stream(request):
    try:
        proc = await asyncio.create_subprocess_exec(
            "journalctl", "-u", "serandip-bot", "-f", "-o", "cat",
            stdout=asyncio.subprocess.PIPE
        )

        resp = web.StreamResponse(
            status=200,
            reason='OK',
            headers={
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
            }
        )
        await resp.prepare(request)
    except Exception as e:
        logger.error(f"Error creating subprocess: {e}")
        return web.Response(text="An error occurred while processing your request.", status=500)
    try:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
                
            try:
                await resp.write(b"data: " + line.strip() + b"\n\n")
            except (ConnectionResetError, asyncio.CancelledError):
                break
    finally:

        try:
            proc.kill()
            await proc.wait()
        except:pass

    return resp

@routes.get('/')
async def index(request) -> Response:
    try:
        return web.Response(text="Welcome to Serandip-prime!", status=200)
    except Exception as e:
        logger.error(f"Error in index route: {e}")
        return web.Response(text="An error occurred while processing your request.", status=500)

@routes.get('/health')
async def health_check(request) -> Response:
    health_data = {
        'status': 'healthy',
        'service': 'D4rkTG',
        'version': '1.5.4',
        'framework': 'aiohttp',
        'timestamp': datetime.now().isoformat()
    }
    
    return web.json_response(health_data, status=200)

async def _web_server(_bot=None) -> Application:
    global bot
    bot = _bot
    web_app = web.Application(client_max_size=30000000)
    web_app.add_routes(routes)
    return web_app

