# telestore/api/routes/files/__init__.py
from telestore.api.routes.files.common import router
from telestore.api.routes.files.browse import get_all_files_route
from telestore.api.routes.files.manage import move_file_route
from telestore.api.routes.files.upload import upload_file
from telestore.api.routes.files import chunked_upload  # noqa: F401  (registers the chunked upload routes)
from telestore.api.routes.files import protection  # noqa: F401  (protect from deletion, folder colours, photo details)

__all__ = ['router', 'get_all_files_route', 'move_file_route', 'upload_file']
