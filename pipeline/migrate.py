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
    if "agent_conversation" not in tables:
        # the same tables as db/schema.sql
        conn.executescript("""
          CREATE TABLE agent_conversation (
            id          TEXT PRIMARY KEY,           -- 화면이 만든 uuid. 되감기·가르기로 세션이 바뀌어도 대화는 그대로
            session_id  TEXT,                       -- Claude Code의 세션 id. 첫 메시지 전에는 NULL
            title       TEXT,                       -- Claude Code가 첫 메시지로 지은 제목, 또는 번역자가 바꾼 것
            model       TEXT NOT NULL,
            effort      TEXT NOT NULL,
            task        TEXT CHECK (task IN ('review','typos')),
            chapter_id  INTEGER,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            used_at     TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE agent_turn (
            session_id  TEXT NOT NULL,
            user_uuid   TEXT NOT NULL,              -- 그 턴을 시작한 번역자의 메시지. 세션 파일의 그 메시지 uuid와 같다
            reason      TEXT NOT NULL,              -- completed, aborted_streaming(멈춤), …
            is_error    INTEGER NOT NULL DEFAULT 0,
            ms          INTEGER,
            cost        REAL,                       -- 그 턴이 더한 비용(추정, 달러)
            checks      TEXT,                       -- 번역 검사(§19) JSON, 검사하지 않은 턴은 NULL
            PRIMARY KEY (session_id, user_uuid)
          );
        """)
        done.append("agent_conversation and agent_turn tables")
    tcols = {r[1] for r in conn.execute("PRAGMA table_info(agent_turn)")}
    if tcols and "checks" not in tcols:
        conn.execute("ALTER TABLE agent_turn ADD COLUMN checks TEXT")
        done.append("agent_turn.checks column")
    acols = {r[1] for r in conn.execute("PRAGMA table_info(agent_conversation)")}
    if acols and "task" not in acols:
        conn.execute("ALTER TABLE agent_conversation ADD COLUMN task TEXT CHECK (task IN ('review','typos'))")
        conn.execute("ALTER TABLE agent_conversation ADD COLUMN chapter_id INTEGER")
        done.append("agent_conversation.task and chapter_id columns")
    if "agent_suggestion" not in {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
        # the same table as db/schema.sql
        conn.executescript("""
          CREATE TABLE agent_suggestion (
            id              INTEGER PRIMARY KEY,
            conversation_id TEXT NOT NULL,          -- 그 제안을 낸 작업 대화
            task            TEXT NOT NULL CHECK (task IN ('review','typos')),
            segment_id      INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
            side            TEXT NOT NULL CHECK (side IN ('source','target')),  -- 리뷰는 번역문, 오탈자는 원문
            quote           TEXT NOT NULL,          -- 바꿀 구절. 그 글에 정확히 한 번 있었던 것만 들어온다
            replacement     TEXT NOT NULL,
            why             TEXT NOT NULL,
            level           TEXT CHECK (level IN ('high','medium','low')),  -- 리뷰만
            base_version    INTEGER NOT NULL,       -- 제안할 때의 단락 버전
            status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed','commented')),
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX idx_suggestion_segment ON agent_suggestion(segment_id, status);
        """)
        done.append("agent_suggestion table")
    if "drill_run" not in {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
        # the same tables as db/schema.sql (Session, docs/session.md)
        conn.executescript("""
          CREATE TABLE drill_run (
            id          INTEGER PRIMARY KEY,
            slot        TEXT,
            status      TEXT NOT NULL CHECK (status IN ('running','done','failed','skipped')),
            segment_ids TEXT,
            made        INTEGER,
            dropped     INTEGER,
            error       TEXT,
            session_id  TEXT,
            cost        REAL,
            ms          INTEGER,
            started_at  TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT
          );
          CREATE TABLE drill_card (
            id           INTEGER PRIMARY KEY,
            run_id       INTEGER NOT NULL REFERENCES drill_run(id),
            segment_id   INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
            kind         TEXT NOT NULL CHECK (kind IN ('meaning','nuance','challenge')),
            origin       TEXT NOT NULL CHECK (origin IN ('claude','picked','asked')),
            written_by   TEXT NOT NULL CHECK (written_by IN ('translator','agent')),
            quote        TEXT NOT NULL,
            question     TEXT NOT NULL,
            options      TEXT,
            answer       INTEGER CHECK (answer BETWEEN 0 AND 3),
            proposal     TEXT,
            why          TEXT NOT NULL,
            base_version INTEGER NOT NULL,
            box          INTEGER NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
            due_on       TEXT NOT NULL,
            made_on      TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','learned','known','disputed','kept','changed','discussed','stale')),
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK ((kind = 'challenge') = (proposal IS NOT NULL)),
            CHECK ((kind = 'challenge') = (options IS NULL AND answer IS NULL))
          );
          CREATE INDEX idx_drill_card_due ON drill_card(status, due_on);
          CREATE TABLE drill_review (
            id          INTEGER PRIMARY KEY,
            card_id     INTEGER NOT NULL REFERENCES drill_card(id) ON DELETE CASCADE,
            answered_on TEXT NOT NULL,
            choice      INTEGER NOT NULL CHECK (choice BETWEEN 0 AND 3),
            correct     INTEGER NOT NULL CHECK (correct IN (0, 1)),
            first       INTEGER NOT NULL CHECK (first IN (0, 1)),
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX idx_drill_review_card ON drill_review(card_id, answered_on);
          CREATE TABLE drill_pick (
            id         INTEGER PRIMARY KEY,
            segment_id INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
            quote      TEXT NOT NULL,
            origin     TEXT NOT NULL CHECK (origin IN ('picked','asked')),
            run_id     INTEGER REFERENCES drill_run(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        """)
        done.append("Session tables (drill_run, drill_card, drill_review, drill_pick)")
    triggers ={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
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
