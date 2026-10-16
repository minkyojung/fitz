"""One-off migrations for databases built before a schema change.

usage: uv run python -m pipeline.migrate OUT/book.db
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path


def migrate(path: Path) -> list[str]:
    conn = sqlite3.connect(path)
    done: list[str] = []
    cols = {r[1] for r in conn.execute("PRAGMA table_info(segment)")}
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "meta" not in tables:
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO meta(key, value) VALUES ('built_at', (SELECT min(updated_at) FROM segment))")
        done.append("meta table")
    if "ocr_text" not in cols:
        conn.execute("ALTER TABLE segment ADD COLUMN ocr_text TEXT")
        # Rows untouched since the build still hold the OCR text. Touched rows cannot be recovered → NULL.
        conn.execute(
            "UPDATE segment SET ocr_text = source_text"
            " WHERE updated_at = (SELECT value FROM meta WHERE key = 'built_at')"
        )
        touched = conn.execute("SELECT count(*) FROM segment WHERE ocr_text IS NULL").fetchone()[0]
        if touched:
            conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_edit_at', datetime('now'))")
        done.append(f"ocr_text column ({touched} edited rows left without original)")
    if "ops" not in tables:
        conn.executescript("""
          CREATE TABLE ops (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, params TEXT NOT NULL,
            inverse_name TEXT NOT NULL, inverse_params TEXT NOT NULL, segment_ids TEXT NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        """)
        done.append("ops table")
    if "target_text" not in cols:
        conn.execute("ALTER TABLE segment ADD COLUMN target_text TEXT")
        done.append("target_text column")
    if "segment_box" not in tables:
        conn.executescript("""
          CREATE TABLE segment_box (
            segment_id INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
            page_no INTEGER NOT NULL,
            x0 REAL NOT NULL, y0 REAL NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL,
            PRIMARY KEY (segment_id, page_no));
        """)
        done.append("segment_box table")
    conn.commit()
    conn.close()
    return done


if __name__ == "__main__":
    for step in migrate(Path(sys.argv[1])):
        print("applied:", step)
