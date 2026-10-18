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
    assert len(steps) == 8
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


def test_migration_adds_glossary_aliases(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("""
      CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);
      CREATE TABLE glossary (id INTEGER PRIMARY KEY, book_id INTEGER, term TEXT, translation TEXT, kind TEXT, memo TEXT);
    """)
    conn.commit(); conn.close()
    assert any("aliases" in s for s in migrate(p))
    conn = sqlite3.connect(p)
    assert "aliases" in {r[1] for r in conn.execute("PRAGMA table_info(glossary)")}
    conn.close()
    assert migrate(p) == []


def test_migration_adds_annotation_columns(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("""
      CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);
      CREATE TABLE note (id INTEGER PRIMARY KEY, segment_id INTEGER, kind TEXT);
      CREATE TABLE comment (id INTEGER PRIMARY KEY, segment_id INTEGER, side TEXT, body TEXT);
    """)
    conn.commit(); conn.close()
    steps = migrate(p)
    assert any("tgt_" in s for s in steps) and any("parent_id" in s for s in steps)
    conn = sqlite3.connect(p)
    assert "tgt_start" in {r[1] for r in conn.execute("PRAGMA table_info(note)")}
    assert "parent_id" in {r[1] for r in conn.execute("PRAGMA table_info(comment)")}
    conn.close()
    assert migrate(p) == []


def test_migration_adds_segment_versions_that_only_go_up(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("""
      CREATE TABLE segment (id INTEGER PRIMARY KEY, idx INTEGER, source_text TEXT, target_text TEXT, updated_at TEXT);
      INSERT INTO segment VALUES (1, 0, 'a', NULL, '2026-01-01'), (2, 1, 'b', NULL, '2026-01-01');
    """)
    conn.commit(); conn.close()
    steps = migrate(p)
    assert "segment.version column" in steps and "segment version triggers" in steps
    conn = sqlite3.connect(p)
    v = lambda i: conn.execute("SELECT version FROM segment WHERE id=?", (i,)).fetchone()[0]
    assert (v(1), v(2)) == (0, 0)
    conn.execute("UPDATE segment SET target_text = '가' WHERE id = 1")
    conn.execute("UPDATE segment SET target_text = '나' WHERE id = 2")
    assert (v(1), v(2)) == (1, 2)
    conn.execute("UPDATE segment SET idx = 5 WHERE id = 1")  # renumbering is not a change of content
    assert v(1) == 1
    conn.execute("DELETE FROM segment WHERE id = 1")
    conn.execute("INSERT INTO segment(id, idx, source_text) VALUES (1, 0, 'a')")  # restored: a new number, never an old one
    assert v(1) == 3
    conn.close()
    assert migrate(p) == []


def test_migration_records_who_made_each_change(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("""
      CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);
      CREATE TABLE ops (id INTEGER PRIMARY KEY, name TEXT NOT NULL, params TEXT NOT NULL, inverse_name TEXT NOT NULL,
                        inverse_params TEXT NOT NULL, segment_ids TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0, created_at TEXT);
      INSERT INTO ops(name, params, inverse_name, inverse_params, segment_ids) VALUES ('updateSegment', '{}', 'updateSegment', '{}', '[1]');
      CREATE TABLE comment (id INTEGER PRIMARY KEY, segment_id INTEGER, side TEXT, parent_id INTEGER, body TEXT NOT NULL, resolved INTEGER, created_at TEXT);
      INSERT INTO comment(segment_id, side, body) VALUES (1, 'source', 'mine');
    """)
    conn.commit(); conn.close()
    steps = migrate(p)
    assert "ops.actor and ops.tool_use_id columns" in steps and "comment.author column" in steps
    conn = sqlite3.connect(p)
    assert conn.execute("SELECT actor, tool_use_id FROM ops").fetchone() == ("translator", None)
    assert conn.execute("SELECT author FROM comment").fetchone() == ("translator",)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE ops SET actor = 'someone'")
    conn.close()
    assert migrate(p) == []
