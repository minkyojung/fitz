import sqlite3
from pathlib import Path

import pytest

from pipeline import db
from pipeline.migrate import migrate


def test_fresh_build_sets_built_at(tmp_path: Path):
    conn = db.create(tmp_path / "b.db")
    assert conn.execute("SELECT value FROM meta WHERE key='built_at'").fetchone()[0]
    conn.close()
    assert not db.has_user_edits(tmp_path / "b.db")


def test_refuses_to_overwrite_edited_db(tmp_path: Path):
    p = tmp_path / "b.db"
    db.create(p).close()
    conn = sqlite3.connect(p)
    conn.execute("INSERT INTO meta(key, value) VALUES ('last_edit_at', datetime('now'))")
    conn.commit(); conn.close()
    with pytest.raises(db.EditedDatabaseError):
        db.create(p)
    assert p.exists()


def test_migration_adds_ocr_text_and_keeps_originals(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("""
      CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);
      INSERT INTO segment VALUES (1, 'untouched', '2026-01-01 00:00:00'),
                                 (2, 'edited later', '2026-01-02 00:00:00');
    """)
    conn.commit(); conn.close()
    steps = migrate(p)
    assert len(steps) == 5
    conn = sqlite3.connect(p)
    assert conn.execute("SELECT ocr_text FROM segment WHERE id=1").fetchone()[0] == "untouched"
    assert conn.execute("SELECT ocr_text FROM segment WHERE id=2").fetchone()[0] is None
    conn.close()
    assert db.has_user_edits(p)
    assert migrate(p) == []  # idempotent


def test_migration_adds_ops_table(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);")
    conn.commit(); conn.close()
    assert any("ops" in s for s in migrate(p))
    conn = sqlite3.connect(p)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(ops)")}
    assert {"name", "params", "inverse_name", "inverse_params", "segment_ids", "undone"} <= cols
    conn.close()
    assert migrate(p) == []


def test_migration_adds_segment_box_table(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);")
    conn.commit(); conn.close()
    assert any("segment_box" in s for s in migrate(p))
    conn = sqlite3.connect(p)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(segment_box)")}
    assert cols == {"segment_id", "page_no", "x0", "y0", "x1", "y1"}
    conn.close()
    assert migrate(p) == []


def test_migration_adds_target_text(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);")
    conn.commit(); conn.close()
    assert any("target_text" in s for s in migrate(p))
    conn = sqlite3.connect(p)
    assert "target_text" in {r[1] for r in conn.execute("PRAGMA table_info(segment)")}
    conn.close()
    assert migrate(p) == []
