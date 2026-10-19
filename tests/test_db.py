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
    assert len(steps) == 11
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


def test_migration_adds_the_agent_conversation_tables(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);")
    conn.commit(); conn.close()
    assert "agent_conversation and agent_turn tables" in migrate(p)
    conn = sqlite3.connect(p)
    assert {r[1] for r in conn.execute("PRAGMA table_info(agent_conversation)")} == {"id", "session_id", "title", "model", "effort", "task", "chapter_id", "created_at", "used_at"}
    assert {r[1] for r in conn.execute("PRAGMA table_info(agent_turn)")} == {"session_id", "user_uuid", "reason", "is_error", "ms", "cost", "checks"}
    conn.close()
    assert migrate(p) == []


def test_migration_adds_task_columns_to_existing_conversations_and_the_suggestion_table(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("""
      CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);
      CREATE TABLE agent_conversation (id TEXT PRIMARY KEY, session_id TEXT, title TEXT, model TEXT NOT NULL, effort TEXT NOT NULL,
                                       created_at TEXT, used_at TEXT);
      INSERT INTO agent_conversation(id, model, effort) VALUES ('c1', 'claude-opus-5-5', 'medium');
    """)
    conn.commit(); conn.close()
    steps = migrate(p)
    assert "agent_conversation.task and chapter_id columns" in steps and "agent_suggestion table" in steps
    conn = sqlite3.connect(p)
    assert conn.execute("SELECT task, chapter_id FROM agent_conversation").fetchone() == (None, None)
    assert {"quote", "replacement", "why", "level", "base_version", "status"} <= {r[1] for r in conn.execute("PRAGMA table_info(agent_suggestion)")}
    conn.close()
    assert migrate(p) == []


def test_migration_adds_the_checks_column_to_kept_turns(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("""
      CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);
      CREATE TABLE agent_conversation (id TEXT PRIMARY KEY, session_id TEXT, title TEXT, model TEXT NOT NULL, effort TEXT NOT NULL,
                                       task TEXT, chapter_id INTEGER, created_at TEXT, used_at TEXT);
      CREATE TABLE agent_turn (session_id TEXT NOT NULL, user_uuid TEXT NOT NULL, reason TEXT NOT NULL, is_error INTEGER NOT NULL DEFAULT 0,
                               ms INTEGER, cost REAL, PRIMARY KEY (session_id, user_uuid));
      INSERT INTO agent_turn(session_id, user_uuid, reason) VALUES ('s1', 'u1', 'completed');
    """)
    conn.commit(); conn.close()
    assert "agent_turn.checks column" in migrate(p)
    conn = sqlite3.connect(p)
    assert conn.execute("SELECT reason, checks FROM agent_turn").fetchone() == ("completed", None)
    conn.close()
    assert migrate(p) == []


def _session_tables(conn: sqlite3.Connection) -> dict[str, str]:
    """The Session tables and indexes as SQLite keeps them, comments and spacing aside: what both paths must agree on."""
    import re
    rows = conn.execute("SELECT name, sql FROM sqlite_master WHERE name LIKE '%drill%' AND sql IS NOT NULL").fetchall()
    return {name: " ".join(re.sub(r"--[^\n]*", "", sql).split()).replace("( ", "(").replace(" )", ")") for name, sql in rows}


def test_migration_adds_the_session_tables_as_the_schema_has_them(tmp_path: Path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript("""
      CREATE TABLE segment (id INTEGER PRIMARY KEY, source_text TEXT, updated_at TEXT);
      INSERT INTO segment(id, source_text) VALUES (1, 'x');
    """)
    conn.commit(); conn.close()
    assert "Session tables (drill_run, drill_card, drill_review, drill_pick)" in migrate(p)
    fresh = db.create(tmp_path / "fresh.db")
    conn = sqlite3.connect(p)
    assert _session_tables(conn) == _session_tables(fresh) and len(_session_tables(fresh)) == 6
    fresh.close()
    # a card is either four options with one answer, or a challenge with a proposal — never both or neither
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("INSERT INTO drill_run(id, slot, through_op, status) VALUES (1, '2026-10-19', 0, 'done')")
    card = "INSERT INTO drill_card(run_id, segment_id, kind, origin, written_by, quote, question, options, answer, proposal, why, base_version, due_on, made_on) VALUES (1, 1, ?, 'claude', 'translator', 'q', '?', ?, ?, ?, 'why', 1, '2026-10-19', '2026-10-19')"
    conn.execute(card, ("meaning", '["a","b","c","d"]', 2, None))
    conn.execute(card, ("challenge", None, None, "p"))
    for bad in [("meaning", None, None, "p"), ("challenge", '["a","b","c","d"]', 0, "p"), ("meaning", '["a","b","c","d"]', 4, None), ("guess", '["a","b","c","d"]', 0, None)]:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(card, bad)
    # a paragraph that goes takes its cards and their answers with it
    conn.execute("INSERT INTO drill_review(card_id, answered_on, choice, correct, first) VALUES (1, '2026-10-19', 2, 1, 1)")
    conn.execute("DELETE FROM segment WHERE id = 1")
    assert conn.execute("SELECT (SELECT count(*) FROM drill_card) + (SELECT count(*) FROM drill_review)").fetchone()[0] == 0
    conn.close()
    assert migrate(p) == []
