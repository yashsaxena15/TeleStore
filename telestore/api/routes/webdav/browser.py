# telestore/api/routes/webdav/browser.py

import os
import urllib.parse
from datetime import datetime
from xml.sax.saxutils import escape as xml_escape
from typing import Optional, Tuple, Dict, Any, List


from telestore.db import database

from telestore.api.routes.webdav.common import VIRTUAL_TOP_LEVEL, resolve_section_item, section_folder_items

def format_size(size_bytes: Optional[int]) -> str:
    """Format bytes into human-readable size string."""
    if not size_bytes or size_bytes <= 0:
        return "-"
    units = ["B", "KB", "MB", "GB", "TB"]
    unit_idx = 0
    size = float(size_bytes)
    while size >= 1024 and unit_idx < len(units) - 1:
        size /= 1024
        unit_idx += 1
    return f"{size:.1f} {units[unit_idx]}" if unit_idx > 0 else f"{int(size)} B"


def format_readable_date(dt_val: Optional[Any]) -> str:
    """Format datetime string or object into human-readable format."""
    if not dt_val:
        return "-"
    try:
        if isinstance(dt_val, datetime):
            return dt_val.strftime("%Y-%m-%d %H:%M")
        clean = str(dt_val).replace("Z", "").split(".")[0].replace("T", " ")
        return clean
    except Exception:
        return str(dt_val)


def get_icon(is_dir: bool, name: str) -> str:
    """Return appropriate emoji icon based on type."""
    if is_dir:
        return "📁"
    ext = os.path.splitext(name)[1].lower()
    if ext in [".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv"]:
        return "🎬"
    elif ext in [".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac"]:
        return "🎵"
    elif ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]:
        return "🖼️"
    elif ext in [".zip", ".rar", ".7z", ".tar", ".gz"]:
        return "📦"
    elif ext in [".pdf", ".doc", ".docx", ".txt", ".epub"]:
        return "📄"
    return "📎"


def get_directory_items(segments: List[str], owner_id: str) -> Tuple[bool, List[Dict[str, Any]]]:
    """
    Check if the target path is a directory/collection.
    Returns (is_directory, items_list).
    """
    # 1. Root /webdav/
    if len(segments) == 0:
        items = [
            {"name": "Home", "is_dir": True, "size": 0, "modified": None, "href": "/webdav/Home/"},
            {"name": "Telegram Inbox", "is_dir": True, "size": 0, "modified": None, "href": "/webdav/Telegram%20Inbox/"},
            {"name": "Starred", "is_dir": True, "size": 0, "modified": None, "href": "/webdav/Starred/"},
            {"name": "Trash", "is_dir": True, "size": 0, "modified": None, "href": "/webdav/Trash/"},
        ]
        return True, items

    # 2. Virtual top level
    if len(segments) == 1 and segments[0] in VIRTUAL_TOP_LEVEL:
        top_name = segments[0]
        items = []
        if top_name == "Home":
            folders = list(database.Files.find({
                "file_type": "folder",
                "file_path": {"$in": ["/Home", "/"]},
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            }))
            for fol in folders:
                fname = fol.get("file_name", "Folder")
                items.append({
                    "name": fname,
                    "is_dir": True,
                    "size": 0,
                    "modified": fol.get("modified_date"),
                    "href": f"/webdav/Home/{urllib.parse.quote(fname, safe='')}/"
                })

            files = list(database.Files.find({
                "file_type": {"$ne": "folder"},
                "file_path": {"$in": ["/Home", "/"]},
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            }))
            for f in files:
                fname = f.get("file_name", "File")
                items.append({
                    "name": fname,
                    "is_dir": False,
                    "size": f.get("file_size", 0),
                    "modified": f.get("modified_date"),
                    "href": f"/webdav/Home/{urllib.parse.quote(fname, safe='')}"
                })

        elif top_name == "Telegram Inbox":
            files = list(database.Files.find({
                "file_path": "/Telegram Inbox",
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            }))
            for f in files:
                fname = f.get("file_name", "File")
                items.append({
                    "name": fname,
                    "is_dir": False,
                    "size": f.get("file_size", 0),
                    "modified": f.get("modified_date"),
                    "href": f"/webdav/Telegram%20Inbox/{urllib.parse.quote(fname, safe='')}"
                })

        elif top_name == "Starred":
            items_cursor = list(database.Files.find({
                "starred": True,
                "owner_id": owner_id,
                "trashed": {"$ne": True},
                "is_vault": {"$ne": True}
            }))
            for it in items_cursor:
                fname = it.get("file_name", "Item")
                is_fol = it.get("file_type") == "folder"
                href = f"/webdav/Starred/{urllib.parse.quote(fname, safe='')}/" if is_fol else f"/webdav/Starred/{urllib.parse.quote(fname, safe='')}"
                items.append({
                    "name": fname,
                    "is_dir": is_fol,
                    "size": it.get("file_size", 0),
                    "modified": it.get("modified_date"),
                    "href": href
                })

        elif top_name == "Trash":
            items_cursor = list(database.Files.find({
                "trashed": True,
                "owner_id": owner_id,
                "is_vault": {"$ne": True}
            }))
            for it in items_cursor:
                fname = it.get("file_name", "Item")
                is_fol = it.get("file_type") == "folder"
                href = f"/webdav/Trash/{urllib.parse.quote(fname, safe='')}/" if is_fol else f"/webdav/Trash/{urllib.parse.quote(fname, safe='')}"
                items.append({
                    "name": fname,
                    "is_dir": is_fol,
                    "size": it.get("file_size", 0),
                    "modified": it.get("trashed_at") or it.get("modified_date"),
                    "href": href
                })

        return True, items

    # 3. Subfolder in Home
    if len(segments) >= 2 and segments[0] == "Home":
        target_subpath = "/" + "/".join(segments)
        parent_db_path = "/" + "/".join(segments[:-1])
        target_name = segments[-1]

        folder_doc = database.Files.find_one({
            "file_type": "folder",
            "file_name": target_name,
            "file_path": parent_db_path if parent_db_path != "/Home" else {"$in": ["/Home", "/"]},
            "owner_id": owner_id,
            "trashed": {"$ne": True}
        })

        if folder_doc:
            items = []
            base_url = "/webdav/" + "/".join(urllib.parse.quote(s, safe="") for s in segments)
            subfolders = list(database.Files.find({
                "file_type": "folder",
                "file_path": target_subpath,
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            }))
            for sf in subfolders:
                sf_name = sf.get("file_name", "Folder")
                items.append({
                    "name": sf_name,
                    "is_dir": True,
                    "size": 0,
                    "modified": sf.get("modified_date"),
                    "href": f"{base_url}/{urllib.parse.quote(sf_name, safe='')}/"
                })

            subfiles = list(database.Files.find({
                "file_type": {"$ne": "folder"},
                "file_path": target_subpath,
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            }))
            for sf in subfiles:
                sf_name = sf.get("file_name", "File")
                items.append({
                    "name": sf_name,
                    "is_dir": False,
                    "size": sf.get("file_size", 0),
                    "modified": sf.get("modified_date"),
                    "href": f"{base_url}/{urllib.parse.quote(sf_name, safe='')}"
                })

            return True, items

    # 4. Folder opened inside Starred or Trash
    if len(segments) >= 2 and segments[0] in ("Starred", "Trash"):
        folder_doc = resolve_section_item(segments, owner_id)
        if folder_doc and folder_doc.get("file_type") == "folder":
            base_url = "/webdav/" + "/".join(urllib.parse.quote(s, safe="") for s in segments)
            items = []
            for child in section_folder_items(segments[0], folder_doc, owner_id):
                cname = child.get("file_name", "Item")
                is_fol = child.get("file_type") == "folder"
                items.append({
                    "name": cname,
                    "is_dir": is_fol,
                    "size": child.get("file_size", 0),
                    "modified": child.get("modified_date"),
                    "href": f"{base_url}/{urllib.parse.quote(cname, safe='')}" + ("/" if is_fol else "")
                })
            return True, items

    return False, []


def render_webdav_html(segments: List[str], items: List[Dict[str, Any]]) -> str:
    """Render a responsive HTML directory listing for browsers."""
    crumbs = ['<a href="/webdav/">webdav</a>']
    accum = []
    for s in segments:
        accum.append(s)
        sub_href = "/webdav/" + "/".join(urllib.parse.quote(seg, safe="") for seg in accum) + "/"
        crumbs.append(f'<a href="{sub_href}">{xml_escape(s)}</a>')
    breadcrumb_html = " / ".join(crumbs)

    parent_row = ""
    if len(segments) > 0:
        if len(segments) == 1:
            parent_href = "/webdav/"
        else:
            parent_href = "/webdav/" + "/".join(urllib.parse.quote(seg, safe="") for seg in segments[:-1]) + "/"
        parent_row = f'''
        <tr class="parent-row">
          <td colspan="4">
            <a href="{parent_href}" class="item-link parent-link">
              <span class="icon">📁</span>
              <span class="name">.. (Parent Directory)</span>
            </a>
          </td>
        </tr>
        '''

    sorted_items = sorted(items, key=lambda x: (not x.get("is_dir", False), x.get("name", "").lower()))

    rows_html = []
    for it in sorted_items:
        name = it.get("name", "")
        escaped_name = xml_escape(name)
        is_dir = it.get("is_dir", False)
        href = it.get("href", "#")
        size_str = format_size(it.get("size"))
        date_str = format_readable_date(it.get("modified"))
        icon = get_icon(is_dir, name)

        action_btn = ""
        if not is_dir:
            action_btn = f'<a href="{href}" download class="action-btn" title="Download">⬇️ Download</a>'
        else:
            action_btn = f'<a href="{href}" class="action-btn folder-btn" title="Open Folder">📂 Open</a>'

        rows_html.append(f'''
        <tr class="item-row" data-name="{escaped_name}">
          <td>
            <a href="{href}" class="item-link {'is-dir' if is_dir else 'is-file'}">
              <span class="icon">{icon}</span>
              <span class="name">{escaped_name}{'/' if is_dir else ''}</span>
            </a>
          </td>
          <td class="size-col">{size_str}</td>
          <td class="date-col">{date_str}</td>
          <td class="action-col">{action_btn}</td>
        </tr>
        ''')

    empty_state = ""
    if not rows_html:
        empty_state = '''
        <tr>
          <td colspan="4" class="empty-state">
            <div style="padding: 30px; text-align: center; color: #94a3b8;">
              <span style="font-size: 32px; display: block; margin-bottom: 8px;">📭</span>
              This directory is empty.
            </div>
          </td>
        </tr>
        '''

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebDAV - /{'/'.join(segments)}</title>
  <style>
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b0f19;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 24px;
    }}
    .container {{
      max-width: 1100px;
      width: 100%;
      margin: 0 auto;
      background: #131b2e;
      border: 1px solid #243049;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }}
    header {{
      padding: 20px 24px;
      background: #182238;
      border-bottom: 1px solid #243049;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }}
    .title-group {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .logo-badge {{
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      font-weight: bold;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 13px;
      letter-spacing: 0.5px;
      border: 1px solid rgba(56, 189, 248, 0.25);
    }}
    .header-links {{
      display: flex;
      gap: 10px;
    }}
    .nav-btn {{
      background: #243049;
      color: #cbd5e1;
      text-decoration: none;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }}
    .nav-btn:hover {{
      background: #334155;
      color: #fff;
    }}
    .primary-btn {{
      background: #0284c7;
      color: #fff;
    }}
    .primary-btn:hover {{
      background: #0369a1;
    }}
    .breadcrumbs-bar {{
      padding: 14px 24px;
      background: #111827;
      border-bottom: 1px solid #243049;
      font-size: 14px;
      color: #94a3b8;
      overflow-x: auto;
      white-space: nowrap;
    }}
    .breadcrumbs-bar a {{
      color: #38bdf8;
      text-decoration: none;
      font-weight: 500;
    }}
    .breadcrumbs-bar a:hover {{
      text-decoration: underline;
    }}
    .toolbar {{
      padding: 14px 24px;
      border-bottom: 1px solid #243049;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }}
    .search-input {{
      background: #0b0f19;
      border: 1px solid #243049;
      color: #f1f5f9;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      width: 100%;
      max-width: 320px;
      outline: none;
      transition: border-color 0.2s;
    }}
    .search-input:focus {{
      border-color: #38bdf8;
    }}
    .count-badge {{
      font-size: 12px;
      color: #94a3b8;
    }}
    .table-container {{
      overflow-x: auto;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }}
    th {{
      padding: 12px 20px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      border-bottom: 1px solid #243049;
      background: #111827;
    }}
    td {{
      padding: 12px 20px;
      font-size: 14px;
      border-bottom: 1px solid #1e293b;
      vertical-align: middle;
    }}
    tr:last-child td {{
      border-bottom: none;
    }}
    tr:hover td {{
      background: rgba(36, 48, 73, 0.4);
    }}
    .item-link {{
      color: #e2e8f0;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 500;
      word-break: break-word;
    }}
    .item-link:hover {{
      color: #38bdf8;
    }}
    .is-dir .name {{
      color: #67e8f9;
      font-weight: 600;
    }}
    .parent-link {{
      color: #94a3b8;
    }}
    .icon {{
      font-size: 18px;
      flex-shrink: 0;
    }}
    .size-col {{
      color: #94a3b8;
      font-family: monospace;
      font-size: 13px;
      white-space: nowrap;
    }}
    .date-col {{
      color: #64748b;
      font-size: 13px;
      white-space: nowrap;
    }}
    .action-col {{
      text-align: right;
      white-space: nowrap;
    }}
    .action-btn {{
      display: inline-block;
      padding: 4px 10px;
      font-size: 12px;
      border-radius: 6px;
      background: #1e293b;
      color: #94a3b8;
      text-decoration: none;
      transition: all 0.15s;
    }}
    .action-btn:hover {{
      background: #0284c7;
      color: #fff;
    }}
    .folder-btn:hover {{
      background: #0d9488;
      color: #fff;
    }}
    footer {{
      padding: 16px 24px;
      background: #0f172a;
      border-top: 1px solid #243049;
      font-size: 12px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }}
    footer a {{
      color: #38bdf8;
      text-decoration: none;
    }}
    @media (max-width: 640px) {{
      body {{
        padding: 10px;
      }}
      th:nth-child(3), td:nth-child(3) {{
        display: none;
      }}
      .search-input {{
        max-width: 100%;
      }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="title-group">
        <span class="logo-badge">WEBDAV LIVE</span>
        <h2 style="font-size: 17px; font-weight: 700;">Telegram WebDAV Server</h2>
      </div>
      <div class="header-links">
        <a href="/" class="nav-btn primary-btn">Go to Main Web App ↗</a>
      </div>
    </header>

    <div class="breadcrumbs-bar">
      📍 Path: {breadcrumb_html}
    </div>

    <div class="toolbar">
      <input type="text" id="searchInput" class="search-input" placeholder="Search / filter files in this folder..." oninput="filterFiles()" />
      <span class="count-badge" id="itemCount">{len(items)} items</span>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th style="width: 130px;">Size</th>
            <th style="width: 170px;">Last Modified</th>
            <th style="width: 110px; text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody id="filesTableBody">
          {parent_row}
          {''.join(rows_html)}
          {empty_state}
        </tbody>
      </table>
    </div>

    <footer>
      <span>💡 <strong>Mount Info:</strong> Mount this URL in Windows using <strong>RaiDrive</strong> or in Android using <strong>MiXplorer</strong>.</span>
      <span>RFC 4918 WebDAV Server</span>
    </footer>
  </div>

  <script>
    function filterFiles() {{
      const q = document.getElementById('searchInput').value.toLowerCase();
      const rows = document.querySelectorAll('.item-row');
      let visible = 0;
      rows.forEach(r => {{
        const name = r.getAttribute('data-name').toLowerCase();
        if (name.includes(q)) {{
          r.style.display = '';
          visible++;
        }} else {{
          r.style.display = 'none';
        }}
      }});
      document.getElementById('itemCount').textContent = visible + ' items';
    }}
  </script>
</body>
</html>'''
    return html
