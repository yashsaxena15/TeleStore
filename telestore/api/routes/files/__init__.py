# telestore/api/routes/files/__init__.py
from telestore.api.routes.files.common import router
from telestore.api.routes.files.browse import get_all_files_route
from telestore.api.routes.files.manage import move_file_route
from telestore.api.routes.files.upload import upload_file

__all__ = ['router', 'get_all_files_route', 'move_file_route', 'upload_file']
