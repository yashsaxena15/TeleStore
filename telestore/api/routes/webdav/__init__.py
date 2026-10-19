# telestore/api/routes/webdav/__init__.py
from telestore.api.routes.webdav.common import router
from telestore.api.routes.webdav.dispatcher import webdav_dispatcher

__all__ = ['router', 'webdav_dispatcher']
