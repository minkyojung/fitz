# fitz — 번역 에디터

영어 원서(스캔 PDF)를 한국어로 번역하기 위한 로컬 전용 도구. PDF와 페이지 이미지는 절대 외부로 나가지 않는다.

## Phase 0: 정본 추출 파이프라인

PDF 텍스트 레이어 → 장/단락 세그먼트 + 원서 페이지 앵커 + 미주 재연결 → SQLite.

```sh
uv sync
uv run pytest
uv run python -m pipeline.build --pdf "<book>.pdf" --out out        # out/book.db, out/pages/*.png, out/report.json
uv run python -m pipeline.build --pdf "<book>.pdf" --out out --no-images
```

| 모듈 | 역할 |
|---|---|
| `pipeline/pdf.py` | 텍스트 레이어를 좌표 있는 줄로 읽기, 러닝헤드 제거, 원서 쪽번호 오프셋 산출 |
| `pipeline/layout.py` | 들여쓰기·행 길이·행간으로 단락/인용 블록 조립, 페이지 넘김 병합 |
| `pipeline/text.py` | 행말 하이픈 복원 |
| `pipeline/junk.py` | 사진 페이지와 OCR 쓰레기 제거 (사전 기반) |
| `pipeline/toc.py` | 차례 파싱 → 장 목록 |
| `pipeline/notes.py` | Notes 섹션 파싱, 인용구 퍼지 매칭으로 본문 단락에 앵커링 |
| `pipeline/db.py` | `db/schema.sql` 적재 |
| `pipeline/images.py` | pdftoppm 페이지 렌더링 |

스키마: `db/schema.sql`. 설계 메모: `.context/translation-editor-plan.md`.

### 검수 모드에서 사람이 잡아야 하는 것
- 이탤릭 (텍스트 레이어에 없음)
- `kind='blockquote'` 세그먼트의 범위, 편지/운문의 줄바꿈
- `note.anchored=0` 미주의 수동 연결
- 사진 페이지의 캡션 (페이지 단위로 버려짐)

## 개발 서버 (임시 로컬 API)

```sh
node server/index.mjs            # http://localhost:4800, out/book.db 와 out/pages 사용
cd app && pnpm dev               # 화면
```

화면은 `app/src/data/api.ts` 인터페이스만 의존한다. 지금 구현은 HTTP(`http.ts`), 나중에 Tauri 명령으로 교체.

## 단축키

`app/src/lib/keymap.ts`의 표 하나가 키 → 명령을 정한다. 버튼, 메뉴, 단축키가 같은 명령 함수를 부른다. 입력 중에는 Esc만 동작한다.

| 키 | 동작 |
|---|---|
| ↓ / ↑ (j / k) | 다음 / 이전 단락 |
| Space | 확인 토글 |
| Enter / Esc | 수정 시작 / 취소 |
| ⌘Z / ⌘⇧Z | 되돌리기 / 다시 실행 |

```sh
cd app && pnpm test:unit   # keymap 단위 테스트
```

상태 바 오른쪽에 저장 상태(저장 중 · 저장됨 · 저장 실패)가 표시된다. 저장 중에 창을 닫으면 경고한다.

## 번역 모드 (Translate 탭)

대역본 모양이다: 왼쪽 여백의 상태 점, 원문(회색, 읽기 전용), 번역(명조 Noto Serif KR, 클릭해 편집). 단락은 원문과 1:1로 마주 보며, 번역은 한 짝 안에서 여러 블록(Enter)으로 쓸 수 있다(`target_doc`은 paragraph+, 평문은 줄바꿈으로 이음). 단락 구조를 바꾸려면 원문 쪽을 검수 모드에서 분할·병합한다.

- 클릭 → 그 자리 편집. Enter 새 블록, ⌘Enter 확정(Reviewed)하고 다음 미확정 짝으로, Esc 취소, Tab/Shift-Tab 이웃 짝, ↑/↓는 글 끝·처음에서 이웃 짝으로 흐른다.
- 상태: untranslated → draft(첫 저장 시 자동) → reviewed(⌘Enter) → final. 사이드바 진행률과 상태 바 "Confirmed n / m", 원고지 매수(200자, 공백 포함, `lib/manuscript.ts`).
- 임시본은 `draft:<book>:<segment>:target`로 원문 임시본과 분리. Focus 토글은 편집 중인 짝만 선명하게.
- 번역문 변경은 `updateSegment`(targetDoc/status)로 기록되어 ⌘Z 가능하며, 이전 번역은 `segment_version`에 스냅샷된다.

## 쪽과 목록의 동기

왼쪽 스캔과 오른쪽 목록은 항상 같은 쪽을 가리킨다. 단락을 고르면 스캔이 그 쪽·그 자리로 가고, 스캔에서 쪽을 넘기면 목록이 그 쪽 첫 단락을 고른다. 넘긴 쪽이 다른 장이면 장을 바꾼다(`lib/pages.ts` `chapterForPage`). 단락이 없는 쪽(빈 면·사진 화보)은 목록 위에 "이 쪽에는 단락이 없습니다"와 **캡션 추가** 버튼을 보인다. 캡션은 그 쪽 이하 마지막 단락 뒤에 자리 표시 글로 삽입되어 바로 편집기로 열리며, ⌘Z로 삭제된다(`insertSegment`/`deleteSegment`).

## 맞춤법 의심 단어

장을 열면 모든 단락을 Hunspell 영어 사전(크롬·워드와 같은 엔진, `dictionary-en`, 앱에 포함)으로 검사해 사전이 만들 수 없는 단어에 표시한다(`lib/spell.ts`). 표시는 저장하지 않고 글·사전·사용자 단어에서 매번 계산한다.

- 교정 후보는 잡음 채널 방식으로 순위를 매긴다(`lib/rank.ts`): OCR 혼동표(`lib/confusions.ts`, I↔T·rn↔m 등) 가중치 × 책 안 단어 빈도 × 앞뒤 단어 짝 빈도(`lib/corpus.ts`, 서버 `listSourceTexts`로 구성). 근거가 있는 1순위 후보는 git diff 모양(취소선 + 초록)으로 본문에 바로 보이며 초록을 클릭하면 수락된다(`updateSegment`, ⌘Z 가능).
- 단어를 클릭하면 전체 후보와 "Add to dictionary". 사용자 사전은 책 단위로 `glossary` 테이블에 저장되며(`addGlossaryWord`/`removeGlossaryWord`, 되돌리기 가능) 나중에 용어집이 이어받는다.
- 편집 중에는 브라우저 기본 맞춤법 밑줄도 켜진다(`spellcheck`).
- 행 헤더에 "Suspects N", 상태 바에 장 합계.

## 찾아 바꾸기

오른쪽 패널 "찾기" 탭(⌘F). 책 전체를 글자 그대로(대소문자 구분) 검색해 장·쪽·건수·발췌를 보여 주고, 결과를 누르면 그 단락으로 점프한다(다른 장이면 전환). "모두 바꾸기"는 서버의 `replaceAll` → `setDocs` 명령 한 행으로 기록되어 ⌘Z 한 번에 전부 돌아온다. 치환은 텍스트 노드 안에서만 일어나 이탤릭 등 mark가 보존되며, 노드 경계에 걸친 일치는 바꾸지 않는다.

## 단락 편집 (위지위그)

편집 중인 단락 하나에만 TipTap 인스턴스가 붙는다(`SegmentEditor.tsx`). 읽기 뷰와 같은 `.reading` 클래스를 써서 전환 시 레이아웃이 움직이지 않는다. 스키마는 단락 하나(Document `content: 'paragraph'`) + 텍스트 + 이탤릭 mark.

- 글을 클릭하면 그 자리에서 바로 편집(커서는 클릭한 글자). 체크·배지·버튼은 선택만.
- Enter / ⌘Enter / 블러 / 다른 단락 클릭 → 저장, Esc → 취소, Tab / Shift-Tab → 저장 후 다음·이전 단락 편집.
- 타이핑 중 서버 저장은 없다. 대신 300ms 디바운스로 localStorage에 임시본(`draft:<book>:<segment>`)을 남긴다. 저장 성공·취소 시 삭제, 저장 실패 시 유지. 다시 열면 "저장 안 됨" 배지로 복구/버리기를 묻는다. 서버 글이 그 사이 바뀌었으면 임시본은 자동 폐기. 임시본은 되돌리기 기록에 포함되지 않는다.
- 되돌리기는 두 층: 편집 중 ⌘Z는 편집기 안 글자 단위, 편집을 끝낸 뒤 ⌘Z는 서버 명령(단락 단위).
- 저장은 ProseMirror doc JSON을 보내고 서버가 텍스트를 파생한다. 분할·병합도 doc를 직접 자르고 이어 mark가 보존된다.

## 명령 체계와 되돌리기

모든 쓰기는 `server/commands.mjs`의 명령 하나를 `execute()`로 실행한다. 한 트랜잭션 안에서 명령을 적용하고, 그 역(inverse)과 함께 `ops` 테이블에 기록하며, DB를 수정됨으로 표시한다. `undo()`는 마지막 기록의 역을 실행하고, `redo()`는 저장된 정방향을 재실행한다. 새 행동은 redo 스택을 버린다.

| 명령 | 역 |
|---|---|
| updateSegment | updateSegment (이전 값) |
| splitSegment | unsplit (원문·확인 상태 복원, tail id 고정) |
| mergeWithNext | unmerge (삭제된 행을 원래 id로 복원, 미주·댓글 복귀) |
| setNoteAnchor | setNoteAnchor (이전 앵커) |

`segment_version`은 병합 시 삭제되며 복원하지 않는다(번역문 히스토리는 아직 미사용).

```sh
node --test server/      # 명령 왕복 단위 테스트
```

## 세그먼트 위치 (segment_box)

단락이 스캔 이미지의 어디에 있는지를 쪽 대비 비율(0~1)로 저장한다. 두 쪽에 걸치면 행 두 개. 새 빌드는 자동으로 채우고, 이미 작업 중인 DB는 추가만 하는 스크립트로 채운다 (덮어쓰기 금지와 무관, 재실행 안전).

```sh
uv run python -m pipeline.boxes --pdf "<book>.pdf" --db out/book.db
```

`ocr_text` 완전 일치 → 분할·병합된 단락은 같은 쪽 안에서 유사 일치(90+) → 못 찾으면 비움.

## 데이터 안전
- 에디터가 한 번이라도 쓰면 `meta.last_edit_at`이 기록되고, 이후 `pipeline.build`는 그 DB를 덮어쓰지 않는다 (다른 `--out`으로 빌드).
- `segment.ocr_text`는 파이프라인이 뽑은 원문이며 이후 불변. 스키마 변경 전 DB는 `uv run python -m pipeline.migrate out/book.db`로 올린다.
