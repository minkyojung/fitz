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
    gcols = {r[1] for r in conn.execute("PRAGMA table_info(glossary)")}
    if gcols and "aliases" not in gcols:
        conn.execute("ALTER TABLE glossary ADD COLUMN aliases TEXT")
        done.append("glossary.aliases column")
    ncols = {r[1] for r in conn.execute("PRAGMA table_info(note)")}
    if ncols and "tgt_exact" not in ncols:
        for col, typ in [("tgt_exact", "TEXT"), ("tgt_prefix", "TEXT"), ("tgt_suffix", "TEXT"), ("tgt_start", "INTEGER"), ("tgt_end", "INTEGER")]:
            conn.execute(f"ALTER TABLE note ADD COLUMN {col} {typ}")
        done.append("note.tgt_* columns")
    ccols = {r[1] for r in conn.execute("PRAGMA table_info(comment)")}
    if ccols and "parent_id" not in ccols:
        conn.execute("ALTER TABLE comment ADD COLUMN parent_id INTEGER REFERENCES comment(id) ON DELETE CASCADE")
        done.append("comment.parent_id column")
    if "segment_box" not in tables:
        conn.executescript("""
          CREATE TABLE segment_box (
            segment_id INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
            page_no INTEGER NOT NULL,
            x0 REAL NOT NULL, y0 REAL NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL,
            PRIMARY KEY (segment_id, page_no));
        """)
        done.append("segment_box table")
    if "version" not in {r[1] for r in conn.execute("PRAGMA table_info(segment)")}:
        conn.execute("ALTER TABLE segment ADD COLUMN version INTEGER NOT NULL DEFAULT 0")
        done.append("segment.version column")
    ocols = {r[1] for r in conn.execute("PRAGMA table_info(ops)")}
    if "actor" not in ocols:
        # every change so far came in through the editor
        conn.execute("ALTER TABLE ops ADD COLUMN actor TEXT NOT NULL DEFAULT 'translator' CHECK (actor IN ('translator','agent'))")
        conn.execute("ALTER TABLE ops ADD COLUMN tool_use_id TEXT")
        done.append("ops.actor and ops.tool_use_id columns")
    ccols = {r[1] for r in conn.execute("PRAGMA table_info(comment)")}
    if ccols and "author" not in ccols:
        conn.execute("ALTER TABLE comment ADD COLUMN author TEXT NOT NULL DEFAULT 'translator' CHECK (author IN ('translator','agent'))")
        done.append("comment.author column")
    triggers = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    if "segment_version_on_update" not in triggers:
        # the same triggers as db/schema.sql
        conn.executescript("""
          CREATE TRIGGER segment_version_on_update AFTER UPDATE OF source_doc, source_text, target_doc, target_text, status, kind, verified ON segment
          BEGIN UPDATE segment SET version = (SELECT max(version) FROM segment) + 1 WHERE id = NEW.id; END;
          CREATE TRIGGER segment_version_on_insert AFTER INSERT ON segment
          BEGIN UPDATE segment SET version = (SELECT max(version) FROM segment) + 1 WHERE id = NEW.id; END;
        """)
        done.append("segment version triggers")
    conn.commit()
    conn.close()
    return done


if __name__ == "__main__":
    for step in migrate(Path(sys.argv[1])):
        print("applied:", step)
