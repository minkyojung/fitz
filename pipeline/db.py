"""SQLite persistence for the canonical source. Schema lives in db/schema.sql."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "db" / "schema.sql"


def pm_doc(text: str) -> str:
    """Minimal ProseMirror doc JSON for one paragraph of plain text."""
    content = [{"type": "text", "text": text}] if text else []
    return json.dumps({"type": "doc", "content": [{"type": "paragraph", "content": content}]}, ensure_ascii=False)


def create(path: Path) -> sqlite3.Connection:
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA.read_text())
    return conn
