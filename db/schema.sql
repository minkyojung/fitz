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
  version       INTEGER NOT NULL DEFAULT 0,  -- 내용이 바뀔 때마다 아래 트리거가 올린다. 저장 시 "내가 본 버전"과 비교
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
  -- 번역문 쪽 앵커 (역주 위치, 저자 각주 번호 위치). 같은 W3C selector
  tgt_exact     TEXT,
  tgt_prefix    TEXT,
  tgt_suffix    TEXT,
  tgt_start     INTEGER,
  tgt_end       INTEGER,
  -- 원서 Notes 섹션의 원래 키 (대조/복구용)
  orig_page     INTEGER,
  orig_quote    TEXT,
  body_source   TEXT,                 -- 저자 미주 원문
  body_target   TEXT,                 -- 번역된 주석 본문 / 역주 본문 (평문)
  anchored      INTEGER NOT NULL DEFAULT 0,  -- 자동 매칭 성공 여부
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 댓글: 작업 메모. 출판물에 안 나감.
CREATE TABLE comment (
  id            INTEGER PRIMARY KEY,
  segment_id    INTEGER NOT NULL REFERENCES segment(id),
  side          TEXT NOT NULL CHECK (side IN ('source','target')),
  parent_id     INTEGER REFERENCES comment(id) ON DELETE CASCADE, -- 답글이면 부모 댓글
  mark_id       TEXT,                 -- (예약) 편집기 mark id
  src_exact     TEXT, src_prefix TEXT, src_suffix TEXT, src_start INTEGER, src_end INTEGER, -- 앵커 (side가 가리키는 글 기준)
  body          TEXT NOT NULL,
  resolved      INTEGER NOT NULL DEFAULT 0,
  author        TEXT NOT NULL DEFAULT 'translator' CHECK (author IN ('translator','agent')), -- 쓴 쪽: 번역자, 또는 번역 에이전트(Claude)
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
  actor          TEXT NOT NULL DEFAULT 'translator' CHECK (actor IN ('translator','agent')), -- 들어온 문: HTTP 경로 = 번역자, fitz 도구 = 에이전트
  tool_use_id    TEXT,                         -- 에이전트의 쓰기면 그 도구 호출 id: 대화의 그 줄과 이어진다
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

-- 번역 에이전트와의 대화 (docs/agent.md §13). 내용은 Claude Code가 자기 세션 파일에 쓴다. 여기는 Octave처럼 목록과,
-- 세션 파일에 없는 것(턴의 시간·비용·끝난 이유, 대화의 모델)만 둔다.
CREATE TABLE agent_conversation (
  id          TEXT PRIMARY KEY,           -- 화면이 만든 uuid. 되감기·가르기로 세션이 바뀌어도 대화는 그대로
  session_id  TEXT,                       -- Claude Code의 세션 id. 첫 메시지 전에는 NULL
  title       TEXT,                       -- Claude Code가 첫 메시지로 지은 제목, 또는 번역자가 바꾼 것
  model       TEXT NOT NULL,
  effort      TEXT NOT NULL,
  task        TEXT CHECK (task IN ('review','typos')),  -- NULL = 자유 대화. 작업 대화는 다시 열 때도 같은 설정(읽기만, 정해진 결과 모양)으로
  chapter_id  INTEGER,                    -- 작업의 범위
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
  checks      TEXT,                       -- 번역 검사(§19) JSON { checked: 단락 id들, rounds: 검사마다 찾은 실패들 } — 마지막이 판정, 그 앞의 수가 돌려보낸 횟수. 검사하지 않은 턴은 NULL
  PRIMARY KEY (session_id, user_uuid)
);

-- Claude의 제안 (리뷰·오탈자, docs/agent.md §4.1). Claude는 찾기만 하고, 반영·무시는 번역자가 한다(되돌릴 수 있는 명령으로).
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

-- 단락 버전: 쓰는 쪽이 둘(번역자와 에이전트)이라, 저장할 때 "내가 본 버전"이 지금 버전과 다르면 덮지 않는다(낙관적 동시성).
-- 책 전체에서 올라가기만 하는 번호를 준다: 지웠다 되살린 단락도 예전 번호로 돌아가지 않는다. DB가 매기므로 어느 쓰기 경로도 빠지지 않는다.
-- 순서(idx)만 바뀌는 재번호는 내용 변경이 아니므로 올리지 않는다.
CREATE TRIGGER segment_version_on_update AFTER UPDATE OF source_doc, source_text, target_doc, target_text, status, kind, verified ON segment
BEGIN
  UPDATE segment SET version = (SELECT max(version) FROM segment) + 1 WHERE id = NEW.id;
END;
CREATE TRIGGER segment_version_on_insert AFTER INSERT ON segment
BEGIN
  UPDATE segment SET version = (SELECT max(version) FROM segment) + 1 WHERE id = NEW.id;
END;

-- Session (docs/session.md): 매일 저녁 그날 바뀐 단락으로 Claude가 만드는 퀴즈. 퀴즈 기록은 ops에 넣지 않는다(⌘Z에 섞이지 않게).
-- 날짜(slot, made_on, due_on, answered_on)는 서버가 셈한 로컬 날짜 'YYYY-MM-DD' — datetime('now')는 UTC다.

-- 카드를 만든 한 번: 저녁 실행(slot = 그날) 또는 번역자가 누른 "더 만들기"(slot = NULL)
CREATE TABLE drill_run (
  id          INTEGER PRIMARY KEY,
  slot        TEXT,                       -- 저녁 실행의 날. NULL = 더 만들기
  through_op  INTEGER NOT NULL,           -- 재료의 끝: 시작할 때의 마지막 ops.id. 끝난 저녁 실행의 최댓값이 다음 재료의 시작
  status      TEXT NOT NULL CHECK (status IN ('running','done','failed','skipped')),  -- skipped = 재료가 없어 Claude를 부르지 않음
  segment_ids TEXT,                       -- 읽게 한 단락 id JSON
  made        INTEGER,                    -- 저장한 카드 수(챌린지 포함)
  dropped     INTEGER,                    -- 서버 검사에서 버린 수
  error       TEXT,
  session_id  TEXT,                       -- Claude Code의 세션 id
  cost        REAL,                       -- 달러(추정)
  ms          INTEGER,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

-- 카드 하나. 뜻·뉘앙스는 보기 넷 중 정답 하나(코드가 채점), 챌린지는 번역의 한 구절과 그 대안(번역자가 정함)
CREATE TABLE drill_card (
  id           INTEGER PRIMARY KEY,
  run_id       INTEGER NOT NULL REFERENCES drill_run(id),
  segment_id   INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('meaning','nuance','challenge')),
  origin       TEXT NOT NULL CHECK (origin IN ('claude','picked','asked')),  -- Claude가 고름 / 번역자가 고름 / 번역자가 물어봄
  written_by   TEXT NOT NULL CHECK (written_by IN ('translator','agent')),  -- 만들 때 그 단락의 번역을 마지막으로 쓴 쪽
  quote        TEXT NOT NULL,              -- 뜻·뉘앙스: 원문의 그 말 / 챌린지: 번역문의 그 구절. 만들 때 그 글에 정확히 한 번
  question     TEXT NOT NULL,
  options      TEXT,                       -- 뜻·뉘앙스: 보기 넷 JSON, 서버가 섞은 순서
  answer       INTEGER CHECK (answer BETWEEN 0 AND 3),  -- 뜻·뉘앙스: 정답 보기의 자리
  proposal     TEXT,                       -- 챌린지: 그 구절 대신 쓸 말
  why          TEXT NOT NULL,
  base_version INTEGER NOT NULL,           -- 만들 때의 단락 버전
  box          INTEGER NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),  -- 간격 1·2·4·8·16일
  due_on       TEXT NOT NULL,              -- 다음에 물을 날. 챌린지는 만든 날
  made_on      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','learned','known','disputed','kept','changed','discussed','stale')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'challenge') = (proposal IS NOT NULL)),
  CHECK ((kind = 'challenge') = (options IS NULL AND answer IS NULL))
);
CREATE INDEX idx_drill_card_due ON drill_card(status, due_on);

-- 답 하나. 상자는 그날 그 카드의 첫 답만 움직이고, 틀린 카드는 그날 맞을 때까지 다시 묻는다
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

-- 번역자가 원문에서 고른 말(Add to Session), 또는 원문 구절로 Claude에게 물어본 것. 다음 실행이 카드로 만든다
CREATE TABLE drill_pick (
  id         INTEGER PRIMARY KEY,
  segment_id INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
  quote      TEXT NOT NULL,
  origin     TEXT NOT NULL CHECK (origin IN ('picked','asked')),
  run_id     INTEGER REFERENCES drill_run(id),  -- 이것을 넘긴 실행. NULL = 아직
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
