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


class EditedDatabaseError(RuntimeError):
    pass


def has_user_edits(path: Path) -> bool:
    """True if the editor has written to this database (meta.last_edit_at is set)."""
    conn = sqlite3.connect(path)
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = 'last_edit_at'").fetchone()
    except sqlite3.OperationalError:  # no meta table: pre-migration file, treat as edited to be safe
        return True
    finally:
        conn.close()
    return row is not None and row[0] is not None


def create(path: Path) -> sqlite3.Connection:
    """Create a fresh database. Refuses to overwrite one that a person has edited."""
    if path.exists():
        if has_user_edits(path):
            raise EditedDatabaseError(
                f"{path} has user edits and will not be overwritten. Build to a different --out directory."
            )
        path.unlink()
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA.read_text())
    conn.execute("INSERT INTO meta(key, value) VALUES ('built_at', datetime('now'))")
    return conn
