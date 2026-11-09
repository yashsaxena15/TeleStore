"""Stopping cleanly (November 2026).

The server's out-of-memory guard stopped TeleStore with SIGTERM. The web server's watchdog took the
end of uvicorn for a crash and started it again, and after the bots stopped the process waited for
its background threads, so it stayed up with no website and Docker never restarted it. Now a stop
is a stop: the watchdog doesn't restart, the process exits, and a stuck shutdown ends after 30 s.
"""

import asyncio
from unittest.mock import MagicMock, patch

from d4rk import _bot_manager
from telestore.api import server as server_module


def test_watchdog_doesnt_restart_after_a_stop_signal():
    servers = []

    class StoppedServer:
        def __init__(self, config):
            self.should_exit = False
            servers.append(self)

        async def serve(self):
            self.should_exit = True  # what uvicorn does on SIGTERM

    async def run():
        manager = server_module.WebServerManager(MagicMock())
        with patch.object(server_module, "_web_server", return_value=MagicMock()), \
                patch.object(server_module.uvicorn, "Server", StoppedServer), \
                patch.object(server_module, "get_public_ip", return_value=None), \
                patch.object(manager, "start_frontend"):
            await manager.setup_web_server(preferred_port=0)
            await asyncio.wait_for(manager._watchdog_task, 5)
        return manager

    manager = asyncio.run(run())
    assert len(servers) == 1 and manager._stopping is True


def test_watchdog_still_restarts_after_a_crash():
    calls = []

    class CrashingServer:
        def __init__(self, config):
            self.should_exit = False

        async def serve(self):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("boom")
            self.should_exit = True

    async def no_wait(_):
        pass

    async def run():
        manager = server_module.WebServerManager(MagicMock())
        with patch.object(server_module, "_web_server", return_value=MagicMock()), \
                patch.object(server_module.uvicorn, "Server", CrashingServer), \
                patch.object(server_module, "get_public_ip", return_value=None), \
                patch.object(server_module.asyncio, "sleep", no_wait), \
                patch.object(manager, "start_frontend"):
            await manager.setup_web_server(preferred_port=0)
            await asyncio.wait_for(manager._watchdog_task, 5)

    asyncio.run(run())
    assert len(calls) == 2


def test_a_stuck_shutdown_ends_the_process():
    timers = []

    class Timer:
        def __init__(self, seconds, fn):
            self.seconds, self.fn, self.daemon = seconds, fn, False
            timers.append(self)

        def start(self):
            pass

    with patch.object(_bot_manager.threading, "Timer", Timer), \
            patch.object(_bot_manager, "_exit_timer", None), \
            patch.object(_bot_manager.os, "_exit") as leave:
        _bot_manager._force_exit_after(30)
        _bot_manager._force_exit_after(30)  # only one timer however many signals
        assert len(timers) == 1 and timers[0].seconds == 30 and timers[0].daemon
        timers[0].fn()
        leave.assert_called_once_with(1)


def test_the_process_exits_after_the_bots_stop():
    import telestore.__main__ as entry
    with patch.object(entry, "start_bot"), \
            patch("telestore.telegram.bot.get_bot_manager"), \
            patch.object(entry.signal, "signal"), \
            patch.object(entry.asyncio, "get_event_loop"), \
            patch.object(entry.os, "_exit") as leave:
        entry.main()
    leave.assert_called_once_with(0)
