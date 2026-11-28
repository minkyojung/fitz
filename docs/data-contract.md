# 데이터 계약 — 기존 book.db를 새 앱이 읽고 쓸 때 지킬 것

이 문서는 구조를 고정하는 문서가 아니다. **2026-11-28 기준으로 확인한 현재 상태**와 **새 앱이 지킬 규칙**을 적는다. 아래의 수(789행 등)와 `user_version = 0` 같은 상태는 프로토타입이 쓰는 책(버전 0)의 것이다. 구조를 바꿀 때는 `PRAGMA user_version`을 올리는 마이그레이션으로 바꾸고, 이 문서도 같은 커밋에서 고친다.

- **확인 대상**: `riga/out/book.db`의 사본(`dev-data/out/book.db`, `.backup`으로 만듦, 원본과 테이블 19개 행 수가 같음), 이 리포의 `db/schema.sql`, 프로토타입 코드(브랜치 `minkyojung/build-ocr-translation-editor`의 `server/`). 코드 위치는 그 브랜치 기준이다.
- **표시**: ✅ = 데이터나 코드로 확인함. ❓ = 미확인. "해석"이라고 쓴 것은 확인한 사실에서 내가 추론한 것이다.

## 1. 파일과 연결
| 규칙 | 근거 |
|---|---|
| 프로토타입의 책은 `user_version = 0`이다. 새 앱은 책을 열기 전에 마이그레이션(`server/migrate.ts`)으로 최신 버전(지금 1)까지 올리고, 그 버전이 아닌 책은 읽지 않는다. 더 새 버전의 책은 건드리지 않고 거절한다 | ✅ PRAGMA, `server/migrate.test.ts` |
| 저널은 `delete` 방식이다(WAL 아님). 사본은 `.backup`이나 `node:sqlite`의 `backup()`으로 만든다 | ✅ PRAGMA, 파일 헤더 |
| 버전 1부터 WAL이다. 마이그레이션이 `journal_mode = WAL`로 바꾸고, 그 전까지(프로토타입이 같은 파일을 쓰는 동안)는 `delete`다. WAL에서는 DB 옆에 `-wal`, `-shm` 파일이 생기므로 사본은 파일 복사가 아니라 `backup()`으로 만든다. 쓰기 내구성은 `synchronous = FULL`(기본값)을 유지한다 | ✅ `server/migrate.ts`. T3 Code·Orca·VS Code가 WAL을 쓴다 |
| 연결마다 `PRAGMA foreign_keys = ON`을 켠다(연결 단위 설정이라 DB에 저장되지 않는다). 지금 `foreign_key_check`의 위반은 0건이다 | ✅ `commands.mjs` `openDb`, PRAGMA |
| `segment.version` 열이 없는 DB는 거절한다(동시 쓰기 보호가 없는 옛 DB) | ✅ `openDb` |
| `db/schema.sql`과 실제 DB는 구조가 같다: 열 172개(이름·타입·NOT NULL·기본값·PK), 외래키 17개, 인덱스 17개, CHECK 25개, 트리거 2개. 다른 것은 열 순서(나중에 `ALTER TABLE ADD COLUMN`으로 붙인 열)와 SQL 주석뿐이다. **열 이름으로 읽고 `SELECT *`의 순서에 기대지 않는다** | ✅ `schema.sql`로 만든 빈 DB와 PRAGMA 비교 |
| 시각 열(`created_at` 등)은 `datetime('now')`, 곧 UTC `YYYY-MM-DD HH:MM:SS`다. Session 표(`drill_*`)의 날짜는 서버가 셈한 로컬 날짜 `YYYY-MM-DD`다 | ✅ `schema.sql` 주석과 표본. 로컬 날짜 계산은 ❓ |

### 마이그레이션 (`server/migrate.ts`)
- 순서: ① `backup()`으로 백업하고 그 백업이 온전한지 확인 → ② 단계마다 트랜잭션 하나로 실행하고 `user_version`을 올림 → ③ 무결성, 외래키, 모든 표의 행 수를 확인 → ④ WAL 전환. 단계가 실패하면 롤백하고, 확인에서 걸리면 백업으로 되돌린다. 어느 경우든 책은 처음 상태로 남는다.
- 각 단계는 행 수가 바뀌는 표를 스스로 밝힌다(버전 1은 `meta` +1). 밝히지 않은 표의 행 수가 바뀌면 손상으로 본다.
- 백업은 지우지 않는다. 지금은 책 옆의 `backups/`에 `<이름>.v<옛 버전>.<날짜-시각>.db`로 둔다(실제 위치는 데이터를 `~/.fitz/`로 옮길 때 정한다).
- **마이그레이션한 책은 프로토타입으로 열면 안 된다.** 프로토타입은 버전 번호와 `undo_floor`를 모르므로, 옛 편집을 ⌘Z로 되돌릴 수 있다. 그래서 실제 `book.db`는 번역자가 프로토타입 작업을 멈춘 뒤에 옮긴다. 그 전까지 마이그레이션은 사본에만 한다.
- 버전 1에서 바뀌는 것은 세 가지뿐이다: `user_version` 1, WAL, `meta.undo_floor`. 스키마와 다른 행은 그대로다(테스트가 전체 내용을 비교한다).

## 2. 단락(`segment`)
| 규칙 | 근거 |
|---|---|
| 원문·번역문은 ProseMirror JSON(`source_doc`/`target_doc`)과 평문(`source_text`/`target_text`)으로 함께 저장된다. 평문은 JSON에서 파생된다: 문단의 text 노드를 이어 붙이고, 문단끼리는 `\n`으로 잇는다. JSON을 쓸 때 평문을 같은 트랜잭션에서 함께 쓴다 | ✅ `commands.mjs` `docText`. 824행 모두 이 규칙과 맞는다(번역문 중 3문단짜리 1행 포함) |
| 쓰인 노드는 `doc → paragraph → text`뿐이고 mark와 attrs는 0개다. 원문은 모두 문단 1개, 번역문은 문단 1개(163행) 또는 3개(1행)다. 프로토타입은 원문을 문단 1개로, 번역문을 문단 1개 이상으로 제한한다 | ✅ 데이터, `checkDoc` |
| 지금 데이터에 mark는 없다. 다만 프로토타입의 검수 편집기에는 기울임(italic) 기능이 있어서 원문에 mark가 생길 수 있다. **새 앱은 노드 구조는 엄격히 검사하되 text 노드의 mark는 받아서 그대로 둔다**(`shared/protocol.ts`의 `Doc`). `schema.sql` 주석의 "댓글/주석 mark 포함"(번역문)은 실제와 다르다 | ✅ 데이터, `app/src/features/review/SegmentEditor.tsx`(프로토타입) |
| **번역됨** = `target_doc IS NOT NULL`. 지금은 세 기준이 모두 164로 같다: `target_doc`이 있음, `target_text`가 비어 있지 않음, `status <> 'untranslated'`(draft 144, reviewed 20). `target_doc = NULL`이면 `target_text`도 NULL이다 | ✅ 데이터, `schema.sql` 주석 |
| 프로토타입의 장 목록 진행률은 "번역됨"이 아니라 `status IN ('reviewed','final')`(확정)과 `verified`(원문 대조)를 센다 | ✅ `listChapters` |
| 장은 26개(`idx` 0~25), 단락은 824개다. 장 안의 `idx`는 0부터 빈틈없이 이어진다. `(chapter_id, idx)`는 UNIQUE라서 번호를 다시 매길 때 음수를 거쳐 옮긴다 | ✅ 데이터, `shiftIdx` |
| `ocr_text`는 파이프라인이 뽑은 원문이고 이후 바꾸지 않는다. NULL 5행, `source_text`와 다른 행 3개 | ✅ 데이터. 다른 3행의 사연은 ❓ |
| `updated_at`은 트리거가 아니라 쓰는 코드가 직접 갱신한다 | ✅ `schema.sql`(트리거 없음), `setText` |

## 3. 단락 버전(`segment.version`)과 동시 쓰기
- ✅ 트리거 두 개가 버전을 매긴다. INSERT 때와, `source_doc, source_text, target_doc, target_text, status, kind, verified` 중 하나가 UPDATE될 때 `(책 전체 max(version)) + 1`이 된다. `idx`만 바뀌는 재번호는 버전을 올리지 않는다. **새 앱은 버전을 직접 쓰지 않고 트리거에 맡긴다.**
- ✅ 지금 값: 0인 행이 660개, 나머지 164행은 모두 서로 다르고 최댓값은 630이다. 버전이 0이 아닌 164행은 번역된 164행과 정확히 같은 행들이다. 해석: 0은 트리거가 생긴 뒤 한 번도 바뀌지 않은 단락이다.
- ✅ 쓰는 쪽이 둘(번역자, Claude)이라 단락 쓰기에는 `expectVersion`(쓰는 쪽이 마지막으로 본 버전)을 받는다. 지금 버전과 다르면 아무것도 쓰지 않고 409로 거절한다. `expectVersion`은 ops에 기록되지 않는다(redo가 기대지 않게). 근거: `commands.mjs` `updateSegment`.
- ✅ 번역문이 바뀌면 이전 번역문이 `segment_version`에 스냅샷으로 남는다(지금 462행, 단락 130개).

## 4. 주석·댓글의 위치(텍스트 앵커)
- ✅ 위치는 W3C Web Annotation 방식의 텍스트 앵커다: `exact`(그 구절), `prefix`/`suffix`(앞뒤 문맥 최대 32자, 없으면 `''`), `start`/`end`(만들 때의 위치). 근거: `server/anchor.mjs`, `app/src/lib/anchor.ts`(둘이 같은 알고리즘).
- ✅ **위치의 단위는 JS 문자열 인덱스(UTF-16 코드 단위)다.** 지금 텍스트에는 BMP 밖의 글자가 없어서 코드 포인트 인덱스와 값이 같다. 새 앱도 UTF-16 단위를 쓴다.
- ✅ 다시 찾는 순서: ① `text.slice(start, end) === exact`이면 그 자리. ② 아니면 `exact`가 나오는 모든 자리 중 앞뒤 문맥이 가장 잘 맞고, 그다음으로 옛 위치에 가장 가까운 곳. ③ `exact`가 없으면 null이고, 추측하지 않는다.
- ✅ `mark_id`는 주석 161행과 댓글 13행 모두 NULL이고, 프로토타입 서버 코드는 이 열을 읽지도 쓰지도 않는다. `schema.sql` 머리 주석의 "번역문 위치는 mark_id가 진실"은 실제와 다르다. **위치의 진실은 텍스트 앵커다.**
- ✅ 열 이름: 주석은 원문 기준 `src_*`, 번역문 기준 `tgt_*`다. 댓글은 `src_*` 열 하나에 `side`('source'/'target')가 가리키는 글 기준으로 저장한다.
- ✅ 실제 앵커를 위 규칙으로 다시 찾은 결과는 아래와 같다. **새 앱은 위치를 못 찾는 앵커(8개)가 있다는 것을 전제로 만든다.**

| 앵커 | 개수 | 저장된 위치 그대로 | 다시 찾음 | 못 찾음 |
|---|---|---|---|---|
| 주석, 원문(`src`) | 141 | 141 | 0 | 0 |
| 주석, 번역문(`tgt`) | 25 | 13 | 11 | 1 |
| 댓글, 원문 | 3 | 3 | 0 | 0 |
| 댓글, 번역문 | 10 | 2 | 1 | 7 |

- 주석 본문 `body_target`은 평문이다(값이 있는 16행 모두 JSON 아님). 실제 DB의 열 주석 "ProseMirror JSON"은 틀렸고, `schema.sql` 주석 "평문"이 맞다. ✅
- ❓ 위치를 못 찾은 앵커를 프로토타입 화면이 어떻게 보여 주는지.

## 5. 편집 기록(`ops`)과 ⌘Z의 경계
- ✅ 프로토타입의 모든 쓰기는 `execute()`를 거친다. 명령 하나를 트랜잭션으로 실행하고, 정방향(`name`, `params`)과 역방향(`inverse_name`, `inverse_params`)을 `ops` 한 행에 남기고, `meta.last_edit_at`을 갱신한다.
- ✅ 지금 789행이다(id 1~789, 2026-10-16 ~ 2026-11-03). 모두 `undone = 0`이다. Claude가 쓴 것(`actor = 'agent'`)은 281행이고 모두 `tool_use_id`가 있다. 정방향 명령 이름은 13가지다(`updateSegment` 648행이 대부분).
- ✅ 프로토타입의 ⌘Z는 "그 쓰는 쪽(actor)의 `undone = 0`인 가장 큰 id"를 되돌린다. 그 뒤에 같은 대상을 건드린 변경이 살아 있으면 거절한다. 새 변경이 생기면 그 쓰는 쪽의 `undone = 1` 행을 **지운다**(redo 끝). `AUTOINCREMENT`가 없어서 지운 맨 위 id는 다시 쓰일 수 있다.
- **경계 규칙(번역자 결정)**: 새 앱으로 옮기기 전의 편집(지금 id ≤ 789)은 ⌘Z 대상이 아니고 이력으로만 남긴다. 프로토타입 규칙을 그대로 옮기면 이 789행이 ⌘Z로 되돌려지므로, **새 앱의 undo·redo·Claude 되감기는 경계 id보다 큰 행만 본다.** 옛 행은 `undone`을 바꾸지 않는다(바꾸면 위 규칙에 따라 지워질 수 있다).
- **경계 id의 자리**: 마이그레이션 버전 1이 그 시점의 `max(ops.id)`(편집이 없으면 0)를 `meta`의 `undo_floor`에 문자열로 적는다. 번역자가 프로토타입으로 계속 작업하는 동안 789는 바뀔 수 있으므로, 상수가 아니라 옮기는 순간의 값이다. ✅ `server/migrate.ts`
- **새 앱의 쓰기(`server/commands.ts`)**: 프로토타입과 같은 모양으로 `ops`에 기록한다(같은 열, 같은 JSON 모양). 달라지는 것은 넷이다. ✅ `server/commands.test.ts`
  - undo·redo는 `id > undo_floor`인 행만 본다. 새 편집이 redo를 끝낼 때 지우는 행도 그 범위 안이다. 그래서 옛 행은 `undone`이 바뀌지도, 지워지지도 않는다.
  - 화면에서 오는 저장은 `expectVersion`이 필수다(규약). 명령 층에서는 선택이다(undo·redo의 재실행은 버전에 기대지 않는다).
  - 아무것도 바꾸지 않는 저장은 기록하지 않고 버전도 올리지 않는다.
  - 같은 글을 다시 보내면 저장된 문서를 그대로 둔다(평문으로 같은 원문을 보내도 기울임이 지워지지 않는다).
- 명령은 지금 `updateSegment` 하나다. 프로토타입의 나머지 명령(분할, 병합, 댓글, 주석, 용어집 등)은 해당 기능을 만들 때 옮긴다. 옛 기록에 그 이름들이 남아 있지만, 경계 아래라서 재실행되지 않는다.

## 6. 그 밖의 표
- ✅ `meta`에는 `built_at`, `last_edit_at` 두 키가 있다. 쓰기마다 `last_edit_at`을 갱신한다(새 앱도 그대로). `schema.sql` 주석에는 "`last_edit_at`이 있으면 빌드가 DB를 덮어쓰지 않는다"고 되어 있다. 파이프라인 쪽 동작은 ❓(코드를 읽지 않았다).
- ✅ 책은 1권이다. `book.source_pdf`는 절대 경로(`/Users/williamjung/Developer/fitz/…pdf`)이고 그 파일이 있다.
- ✅ `page.image_path` 294행은 모두 `out/pages/page-NNN.png`이다. 프로토타입 서버는 이 경로에서 **파일 이름만**(`basename`) 쓰고, 폴더는 서버 옵션 `--pages`로 정한다. 개발 사본은 riga와 같은 배치(`dev-data/out/pages/`)다.
- ✅ 퀴즈 기록(`drill_*`)은 `ops`에 넣지 않는다(⌘Z에 섞이지 않게). 근거: `schema.sql` 주석.

## 7. Claude 대화 파일
- ✅ Claude의 작업 폴더는 `~/.fitz/agent`다(`server/agent/session.mjs` `AGENT_CWD`). Claude Code는 대화 파일을 `<설정 폴더>/projects/<작업 폴더 경로에서 영숫자가 아닌 글자를 모두 '-'로 바꾼 이름>/<session_id>.jsonl`에 쓴다. 이 맥에서는 `CLAUDE_CONFIG_DIR`이 없어서 `~/.claude/projects/-Users-williamjung--fitz-agent/`다. **`~/.fitz/agent` 경로가 바뀌면 이 폴더 이름이 바뀌어 옛 대화를 찾지 못한다.**
- ✅ `~/.fitz/sessions/<session_id>.jsonl`은 fitz가 만든 사본이다. Claude Code가 30일이 지난 대화 파일을 지우기 때문이다. 원래 위치에 파일이 없으면 이 사본을 원래 자리에 복사해 넣고 다시 연다(`server/agent/keep.mjs`).
- ✅ **지금 대화 29개(`agent_conversation`) 모두 `~/.fitz/sessions`에 사본이 있다. 원래 위치에는 9개만 남아 있다. 나머지 20개는 `~/.fitz/sessions`가 유일한 사본이다.** 새 앱은 이 폴더를 지우거나 옮기지 않고, 같은 복원 규칙을 지킨다. 파일 형식은 Claude Code의 것이므로 fitz는 고치지 않는다.
- ❓ 퀴즈 실행(`drill_run`)의 세션 5개는 어느 작업 폴더에서 돌았고 사본이 있는지(`~/.fitz/sessions`에는 대화 29개 외의 파일이 없다).

## 8. 미확인 목록
1. 위치를 못 찾은 앵커 8개를 프로토타입 화면이 어떻게 보여 주는지.
2. `ocr_text`가 `source_text`와 다른 3행과 NULL인 5행의 사연.
3. 파이프라인의 `last_edit_at` 보호 동작.
4. 퀴즈 실행 세션의 작업 폴더와 대화 파일 위치.
5. Session 날짜를 셈할 때 쓰는 시간대.
