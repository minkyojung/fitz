-- 번역 에디터 SQLite 스키마 v0 (2026-10-16)
-- 원칙: segment가 중심. 모든 주석/댓글은 segment_id를 1차 키로 갖고, 세부 위치는 측면(side)에 따라 다른 앵커를 쓴다.
--   target(번역문, 편집됨): mark_id — 문서 JSON 안의 mark가 위치의 진실
--   source(원문, 읽기전용): exact/prefix/suffix + start/end (W3C Web Annotation 방식)

PRAGMA foreign_keys = ON;

-- 책 단위 메타. last_edit_at 이 있으면 사람이 손댄 DB → 빌드가 덮어쓰지 않는다.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE book (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT,
  source_pdf  TEXT NOT NULL,          -- 로컬 경로. 파일 자체는 DB에 넣지 않음
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE chapter (
  id          INTEGER PRIMARY KEY,
  book_id     INTEGER NOT NULL REFERENCES book(id),
  idx         INTEGER NOT NULL,       -- 책 안 순서
  title       TEXT NOT NULL,
  start_page  INTEGER,                -- 원서 페이지
  UNIQUE (book_id, idx)
);

CREATE TABLE page (
  book_id     INTEGER NOT NULL REFERENCES book(id),
  page_no     INTEGER NOT NULL,       -- 원서 페이지 번호 (PDF 인덱스 아님)
  pdf_index   INTEGER NOT NULL,
  image_path  TEXT NOT NULL,          -- 로컬 렌더링 이미지
  PRIMARY KEY (book_id, page_no)
);

CREATE TABLE segment (
  id            INTEGER PRIMARY KEY,
  chapter_id    INTEGER NOT NULL REFERENCES chapter(id),
  idx           INTEGER NOT NULL,     -- 장 안 순서. 분할/병합 시 재번호
  kind          TEXT NOT NULL DEFAULT 'paragraph'
                CHECK (kind IN ('paragraph','heading','blockquote','caption','verse')),
  page_start    INTEGER NOT NULL,     -- 원서 페이지 앵커
  page_end      INTEGER NOT NULL,
  ocr_text      TEXT,                 -- 파이프라인이 뽑은 원문. 이후 불변. NULL = 원본 복원 불가(마이그레이션 전 수정)
  source_doc    TEXT NOT NULL,        -- ProseMirror JSON (이탤릭 mark 포함)
  source_text   TEXT NOT NULL,        -- 평문. 검색/앵커 매칭용 (source_doc에서 파생)
  target_doc    TEXT,                 -- ProseMirror JSON (댓글/주석 mark 포함). NULL = 미번역
  target_text   TEXT,                 -- 번역문 평문 (target_doc에서 파생). 검색·매수 계산용
  status        TEXT NOT NULL DEFAULT 'untranslated'
                CHECK (status IN ('untranslated','draft','reviewed','final')),
  verified      INTEGER NOT NULL DEFAULT 0,  -- 검수 모드에서 원본 대조 확인됨
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chapter_id, idx)
);

-- 세그먼트가 스캔 이미지의 어디에 있는지. 쪽 크기 대비 비율(0~1)이라 DPI와 무관. 두 쪽에 걸치면 행 두 개.
CREATE TABLE segment_box (
  segment_id  INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
  page_no     INTEGER NOT NULL,
  x0 REAL NOT NULL, y0 REAL NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL,
  PRIMARY KEY (segment_id, page_no)
);

-- 주석: 저자 미주(author) + 역주(translator). 출판물에 나감.
CREATE TABLE note (
  id            INTEGER PRIMARY KEY,
  segment_id    INTEGER NOT NULL REFERENCES segment(id),
  kind          TEXT NOT NULL CHECK (kind IN ('author','translator')),
  -- 위치: target_doc 안 mark id (번역문 기준 번호 각주가 붙는 자리)
  mark_id       TEXT,                 -- NULL = 아직 번역문에 안 붙음 (segment 단위로만 연결)
  -- 원문 쪽 앵커 (저자 미주 재연결용, W3C selector)
  src_exact     TEXT,
  src_prefix    TEXT,
  src_suffix    TEXT,
  src_start     INTEGER,
  src_end       INTEGER,
  -- 원서 Notes 섹션의 원래 키 (대조/복구용)
  orig_page     INTEGER,
  orig_quote    TEXT,
  body_source   TEXT,                 -- 저자 미주 원문
  body_target   TEXT,                 -- 번역된 주석 본문 (ProseMirror JSON)
  anchored      INTEGER NOT NULL DEFAULT 0,  -- 자동 매칭 성공 여부
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 댓글: 작업 메모. 출판물에 안 나감.
CREATE TABLE comment (
  id            INTEGER PRIMARY KEY,
  segment_id    INTEGER NOT NULL REFERENCES segment(id),
  side          TEXT NOT NULL CHECK (side IN ('source','target')),
  mark_id       TEXT,                 -- side='target'일 때
  src_exact     TEXT, src_prefix TEXT, src_suffix TEXT, src_start INTEGER, src_end INTEGER, -- side='source'일 때
  body          TEXT NOT NULL,
  resolved      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE glossary (
  id            INTEGER PRIMARY KEY,
  book_id       INTEGER NOT NULL REFERENCES book(id),
  term          TEXT NOT NULL,        -- 원어
  translation   TEXT NOT NULL,        -- 확정 표기 ('' = 아직 미정, 사전 단어로만 쓰임)
  aliases       TEXT,                 -- 허용 변형, 쉼표 구분 (예: "샘 제무레이")
  kind          TEXT NOT NULL DEFAULT 'other'
                CHECK (kind IN ('person','place','org','work','other')),
  memo          TEXT,
  UNIQUE (book_id, term)
);
-- 용어 출현 위치는 저장하지 않고 source_text 검색으로 파생

-- 명령 기록. 모든 쓰기는 한 행을 남기고, undo는 inverse를, redo는 정방향을 재실행한다.
CREATE TABLE ops (
  id             INTEGER PRIMARY KEY,          -- 실행 순서
  name           TEXT NOT NULL,                -- 정방향 명령
  params         TEXT NOT NULL,                -- 정방향 인자 JSON (생성된 id가 고정되어 재실행 가능)
  inverse_name   TEXT NOT NULL,
  inverse_params TEXT NOT NULL,
  segment_ids    TEXT NOT NULL,                -- 영향받은 세그먼트 id JSON (이력 조회용)
  undone         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 번역문 버전 히스토리 (저장 시마다 스냅샷)
CREATE TABLE segment_version (
  id            INTEGER PRIMARY KEY,
  segment_id    INTEGER NOT NULL REFERENCES segment(id),
  target_doc    TEXT NOT NULL,
  saved_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_segment_chapter ON segment(chapter_id, idx);
CREATE INDEX idx_segment_page    ON segment(page_start);
CREATE INDEX idx_note_segment    ON note(segment_id);
CREATE INDEX idx_comment_segment ON comment(segment_id);
CREATE INDEX idx_version_segment ON segment_version(segment_id, saved_at);
