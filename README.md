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
cd server && pnpm install     # 처음 한 번 (docx 내보내기 라이브러리)
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
- 임시본은 `draft:<book>:<segment>:target`로 원문 임시본과 분리. Focus 토글은 편집 중인 짝만 선명하게. 스캔 패널은 번역 모드에서 기본으로 접히며 Scan 토글 또는 ⌘I로 연다.
- 번역문 변경은 `updateSegment`(targetDoc/status)로 기록되어 ⌘Z 가능하며, 이전 번역은 `segment_version`에 스냅샷된다.

## 쪽과 목록의 동기

왼쪽 스캔과 오른쪽 목록은 항상 같은 쪽을 가리킨다. 단락을 고르면 스캔이 그 쪽·그 자리로 가고, 스캔에서 쪽을 넘기면 목록이 그 쪽 첫 단락을 고른다. 넘긴 쪽이 다른 장이면 장을 바꾼다(`lib/pages.ts` `chapterForPage`). 단락이 없는 쪽(빈 면·사진 화보)은 목록 위에 "이 쪽에는 단락이 없습니다"와 **캡션 추가** 버튼을 보인다. 캡션은 그 쪽 이하 마지막 단락 뒤에 자리 표시 글로 삽입되어 바로 편집기로 열리며, ⌘Z로 삭제된다(`insertSegment`/`deleteSegment`).

## 선택 툴바 (하나의 선택 모델)

텍스트 선택은 어디서 생기든 같은 모델(`lib/selection.ts`: 세그먼트·측면·텍스트·오프셋·사각형·출처)로 모인다. 어댑터 둘이 공급한다: 읽기 블록의 DOM 선택(`features/selection/useDomSelection.ts`)과 열린 편집기의 ProseMirror 선택(`SegmentEditor.onSelect`). `FloatingToolbar`는 shadcn Popover를 선택 사각형(가상 앵커)에 붙여 띄우므로 위치·충돌·스크롤을 Popover가 처리하고, 마우스 드래그든 편집기 안의 Shift+화살표든 같은 툴바가 뜬다. 드래그로 끝난 클릭은 편집 시작으로 보지 않는다.

## 댓글과 역주

텍스트를 드래그하면 뜨는 툴바에서 **Comment**(원문·번역문), **Translator's note**(번역문)를 바로 씁니다. 앵커는 인용구+앞뒤 문맥+당시 오프셋(W3C Web Annotation 방식, `lib/anchor.ts`)으로 저장하고 표시할 때마다 다시 찾습니다(오프셋 → 문맥 일치 → 인용구). 본문 표시: 댓글은 노란 틴트 배경+같은 색 아래 테두리, 각주 번호는 파란 위첨자(저자 주 번호, 역주 `*`, 최종 번호 체계는 내보내기에서 결정, `lib/footnotes.ts`). 고친 글은 색 없이 "edited" 점만(호버 시 원문 대비 diff). 패널 **Notes** 탭에 선택 단락의 댓글 스레드(답글·Resolve·삭제)와 역주(본문 편집·삭제)·저자 주가 순서대로 있고, 미연결 저자 주 목록은 아래에 있습니다. 모든 동작은 명령으로 기록되어 ⌘Z가 됩니다.

**저자 주 자리 잡기.** 저자 주는 원문 문단에 연결돼 들어오지만, 번역문의 어느 단어 뒤에 번호가 붙을지는 번역자가 정합니다. 아직 안 정한 주는 번역 문단 끝에 회색 점선 번호로 임시 표시되고(툴팁에 안내), 번호는 그 자리를 기준으로 이미 매겨져 있습니다. 번역문에서 해당 구절을 선택하면 툴바에 **Place note n**이 뜨고, 누르면 번호가 그 자리로 옮겨져 파란색이 됩니다(`setNote(targetAnchor)`, ⌘Z로 해제). 번호 매김은 `lib/footnotes.ts`가 매번 계산하고, 임시 표시는 `features/notes/overlays.ts`가 마지막 블록 끝에 넣습니다.

## docx 내보내기 (Export 탭)

장을 고르고 주석 방식을 고르면 Word 파일 하나를 받습니다. 서버가 SQLite에서 바로 만들며(`server/export.mjs` → `server/docx.mjs`, 라이브러리 `docx`), 각주·미주는 글자로 흉내 내지 않고 **Word 고유 각주·미주 객체**로 넣어 Word가 번호를 매기고 InDesign 가져오기에서도 주석으로 유지됩니다. 두 층으로 나뉩니다: `buildManuscript`가 "무엇을 어디에"(장 → 문단 → 블록 → 런과 주석 참조, 경고, 통계)를 순수하게 결정하고, `renderDocx`가 그것을 파일로 씁니다.

- **문단**: 세그먼트 1개 = Word 문단 1개(번역 블록이 여럿이면 여럿). 빈 문단 없음. 종류는 스타일 이름으로만 구분(Body, Heading 1, Quote, Caption, Verse). 글꼴·크기는 디자이너 소관.
- **장**: 장 = Word 섹션. 첫 세그먼트가 heading이면 그것이(번역된) 장 제목, 아니면 목차 제목을 Heading 1로 넣음.
- **주석 방식**: A = 저자 주는 장 끝 미주(번호, 장마다 재시작), 역주는 쪽 아래 각주(`* † ‡`, 쪽마다 재시작). B = 전부 각주 한 번호줄, C = 전부 미주 한 번호줄. B·C에서는 역주 끝에 " —옮긴이". 저자 주 본문은 번역(`body_target`)이 있으면 번역, 없으면 영어 원문.
- **자리**: 번역문에 놓인 저자 주는 그 자리에, 안 놓은(또는 앵커가 더는 안 맞는) 주는 문단 끝에 두고 경고. 미번역 문단은 영어 원문을 노란 형광으로 넣고 경고(저자 주는 원서 자리에).
- **경고·통계**: Export 탭이 `exportSummary`로 미리 보여 줌(장별 미번역·미배치 수, 주석 수, 원고지 환산은 번역문 글자만). 파일명 `제목_장범위_날짜.docx`.
- 댓글은 내보내지 않음. 설정은 저장하지 않음(기본 A).

처음 한 번 `cd server && pnpm install`. 테스트: `node --test server/`(모델·XML 검사), `cd app && pnpm e2e`(다운로드까지).

## 용어집

표기는 `glossary`(원어, 표기, 별칭, 종류) 한 곳에만 저장하고 표시는 매번 계산한다(`lib/glossary.ts`). 원문에서 용어는 단어 경계·대소문자 무시·'s/s 허용으로 찾아 초록 밑줄(표기 미정이면 점선)로 표시하고 호버하면 "원어 → 표기". 번역 모드에서는 원문에 용어가 있는데 번역문에 표기(또는 별칭)가 없으면 상태 점 옆에 경고 점이 뜬다. 원문에서 글자를 드래그하면 "Add to glossary" 버튼이 뜨고, 패널 Glossary 탭에서 표기·별칭·종류를 인라인으로 고친다(`setGlossaryTerm`, 되돌리기 가능). 맞춤법의 "Add to dictionary"와 같은 테이블이라 사전 단어가 곧 용어집 초안이다.

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

모든 쓰기는 `server/commands.mjs`의 명령 하나를 `execute()`로 실행한다. 한 트랜잭션 안에서 명령을 적용하고, 그 역(inverse)과 함께 `ops` 테이블에 누가 했는지(번역자/Claude)와 함께 기록하며, DB를 수정됨으로 표시한다. `undo(db, 누구)`는 그 사람의 마지막 기록의 역을 실행하고, `redo()`는 저장된 정방향을 재실행한다 — 단, 그 뒤에 기록되어 아직 서 있는 변경이 같은 것(단락의 글, 용어, 댓글 스레드, 역주, 제안)을 건드렸으면 거절한다(`touches`). 새 행동은 같은 사람의 redo 스택만 버린다. Claude의 변경은 도구 호출 id로 묶어 `undoAgent()`가 한꺼번에(전부 아니면 하나도) 되돌린다.

| 명령 | 역 |
|---|---|
| updateSegment | updateSegment (이전 값) |
| splitSegment | unsplit (원문·확인 상태 복원, tail id 고정) |
| mergeWithNext | unmerge (삭제된 행을 원래 id로 복원, 미주·댓글 복귀) |
| setNoteAnchor | setNoteAnchor (이전 앵커) |

`segment_version`은 병합 시 삭제되며 복원하지 않는다(번역문 히스토리는 아직 미사용).

```sh
node --test server/      # 명령 왕복·내보내기 단위 테스트
```

## 세그먼트 위치 (segment_box)

단락이 스캔 이미지의 어디에 있는지를 쪽 대비 비율(0~1)로 저장한다. 두 쪽에 걸치면 행 두 개. 새 빌드는 자동으로 채우고, 이미 작업 중인 DB는 추가만 하는 스크립트로 채운다 (덮어쓰기 금지와 무관, 재실행 안전).

```sh
uv run python -m pipeline.boxes --pdf "<book>.pdf" --db out/book.db
```

`ocr_text` 완전 일치 → 분할·병합된 단락은 같은 쪽 안에서 유사 일치(90+) → 못 찾으면 비움.

## 데이터 안전
- 서버는 이 컴퓨터만 쓸 수 있다. 다른 웹사이트에서 온 요청(Origin)과 이 컴퓨터가 아닌 이름으로 온 요청(Host, DNS 리바인딩)은 처리 전에 거절하고, CORS는 그 페이지의 Origin만 돌려준다. 원서 글과 쪽 이미지가 브라우저의 다른 탭으로 새지 않고, 다른 사이트가 쓰기를 실행할 수도 없다. 터미널 스크립트처럼 Origin이 없는 로컬 프로그램은 쓸 수 있다.
- 에디터가 한 번이라도 쓰면 `meta.last_edit_at`이 기록되고, 이후 `pipeline.build`는 그 DB를 덮어쓰지 않는다 (다른 `--out`으로 빌드).
- 단락마다 `version`이 있어, 저장할 때 편집을 시작한 뒤 다른 쪽(번역 에이전트, 다른 창)이 바꿨으면 덮지 않고 거절한다. 쓰던 글은 "Unsaved — the paragraph changed since"로 남아 Recover(내 글로 다시 저장)나 Discard를 고른다. 저장이 성공하기 전에는 쓰던 글을 지우지 않는다. 버전 칸이 없는 옛 DB는 서버가 열지 않으니 `uv run python -m pipeline.migrate out/book.db`로 올린다.
- `segment.ocr_text`는 파이프라인이 뽑은 원문이며 이후 불변. 스키마 변경 전 DB는 `uv run python -m pipeline.migrate out/book.db`로 올린다.

## 번역 에이전트 (Claude)

Claude Code를 에디터 서버 안에서 돌려, 책을 직접 읽고 답하게 한다. 설계와 진행은 `docs/agent.md`.

### 에디터 안의 Claude 탭

오른쪽 패널의 **Claude** 탭(설계 §17).

- **묻기**: 본문에서 구절을 골라 툴바의 **Ask Claude**(또는 ⌘L, 편집 중에도 된다). 그 구절과 단락이 입력칸에 붙고, 보내면 "¶604 (English): “…”"로 질문 앞에 들어간다. 그냥 입력칸에 써도 된다. Enter 보내기, Shift+Enter 줄바꿈.
- **보이는 것**: Claude가 읽은 것("Read ¶4 and 3 around")·웹에서 찾은 것("Searched the web for “…”")과 생각("Thought", 누르면 펼침)이 답 위에 한 줄씩, 답은 마크다운으로, 턴 끝에 걸린 시간과 비용.
- **쓰기 허락**: Claude가 번역·용어집·댓글·역주를 쓰려 하면 대화 안에 카드(바뀌는 것 전/후)가 뜬다. **Allow**(이번만), **Always**(이 대화 동안 그 종류는), **Deny**. 허락한 변경은 본문에 바로 보인다. Claude가 답을 기다리는 동안 탭에 숫자가 뜬다.
- **되돌리기**: ⌘Z는 **내가 한 변경만** 되돌린다(Claude의 변경은 건너뛴다). Claude가 한 변경은 대화에서 그 턴 끝의 **Undo from here**로 — 그 턴부터 대화 끝까지의 Claude 변경을 한꺼번에(Claude Code의 rewind처럼). 되돌린 쓰기는 대화에 취소선으로 남는다. 그 뒤 상대가 같은 단락의 글·용어·댓글·역주를 고쳤으면 되돌리지 않고 누가 무엇을 바꿨는지 알려 준다(덮어쓰지 않기 위해).
- **번역 검사**: Claude가 번역을 넣은 턴은 끝나기 전에 fitz가 그 단락을 검사한다 — 용어집 표기(원문에 용어가 있으면 합의된 번역이나 대체 표기가 번역문에), 번역 안에 자리가 있던 원주·역주의 그 구절. 틀리면 어디가 무엇이 틀렸는지 Claude에게 돌려보내 같은 턴에서 고치게 한다(최대 3번). 내가 직접 요청한 표기처럼 그대로가 맞으면 Claude는 이유를 한 줄로 말하고 멈춘다. 턴 끝에 "✓ Checked ¶3 · fixed after 1 try" 또는 "⚠ 1 problem left"와 남은 것이 보이고, 대화를 다시 열어도 같다(검사 결과는 앱이 기록한다). 검사를 못 돌렸으면 "Not checked" — 통과로 보이지 않는다. 내가 멈춘 턴은 판정하지 않는다.
- **멈추기**: 답하는 동안 보내기 버튼이 정지 버튼이 된다.
- **대화**: 머리 줄의 제목을 누르면 지난 대화 목록과 New conversation. 입력칸 아래에서 모델과 생각 강도를 고른다(기본 Opus 5.5 · medium). 대화 도중에도 바꿀 수 있고 다음 메시지부터 그 모델이 답한다(답하는 중에는 잠긴다). 서버를 다시 켜도 바꾼 값으로 이어 간다. 머리 줄 오른쪽 **Suggestions**를 누르면 이 장의 리뷰·OCR 제안이 펼쳐진다.
- 패널 폭은 끌어서 바꾸고, 다시 열어도 기억된다(스캔이 보일 때와 아닐 때 따로).

### 터미널에서

같은 대화를 터미널에서도 쓸 수 있다.

```sh
node server/index.mjs                          # 서버가 화면과의 실시간 연결도 연다 (ws://localhost:4800/live)
node server/agent/chat.mjs                     # 다른 터미널에서. 예: ¶36의 뉘앙스는?
node server/agent/chat.mjs --model claude-sonnet-5-5 --effort low
node server/agent/chat.mjs --list               # 지난 대화 목록 (최근 것부터)
node server/agent/chat.mjs --open <대화 id>      # 지난 대화를 이어서: 지금까지의 내용이 보이고 다음 질문을 받는다
```

- Enter로 보내고, 답이 도는 중 Ctrl-C는 멈추기, 쉬는 중 Ctrl-C는 종료. 턴마다 걸린 시간과 비용(추정)이 찍힌다.
- 에이전트가 가진 것은 책을 읽는 도구 넷(`book`, `read`, `glossary`, `search`)과 쓰는 도구 넷(`set_translation`, `set_glossary_term`, `add_comment`, `add_translator_note`), 그리고 웹 검색(`WebSearch`, 묻지 않는다, 나가는 것은 검색어뿐)이다. 파일·셸 도구와 웹페이지를 여는 도구는 없으므로 PDF와 쪽 이미지는 열 수 없다.
- 쓰기 전에는 반드시 묻는다. 바뀔 내용(전/후)이 보이고 `y` 허락, `a` 이 대화 동안 그 종류는 항상 허락, `n` 거절. 번역문은 늘 draft로 들어가고(확정은 사람), 모든 쓰기는 명령으로 기록되어 ⌘Z로 되돌아간다. Claude가 남긴 댓글에는 "Claude" 표시가 붙고, 모든 변경 기록에 누가 했는지(번역자/Claude)가 남는다.
- 에이전트가 쓴 것(그리고 다른 창의 저장, ⌘Z)은 에디터에 바로 나타난다(서버와 화면 사이의 실시간 연결 `/live` 하나로).
- 대화는 책 DB에 목록으로 남고(내용은 Claude Code의 세션 파일), 서버를 다시 켜도 `--open`으로 이어 간다. Claude Code는 30일 지난 대화 파일을 지우므로 턴이 끝날 때마다 `~/.fitz/sessions/`에 사본을 두고, 원본이 없으면 되돌려 놓는다.
- 테스트: `cd server && pnpm test`(가짜 세션, 비용 없음), `pnpm test:real`(진짜 Claude Haiku로 한 번, 사용량을 조금 쓴다), `cd app && pnpm e2e`(헤드리스 브라우저).
- 자격: 환경에 `ANTHROPIC_API_KEY`가 있으면 그 키를, 없으면 이 Mac의 Claude 로그인을 쓴다. 서버가 시작할 때 어느 쪽인지 찍는다.

### Claude의 리뷰와 OCR 오류 찾기 (에디터 안에서)

**Claude** 탭 머리 줄의 **Suggestions**(누르면 펼쳐진다). Translate 보기에서는 "Review this chapter with Claude"(번역문 리뷰), Review 보기에서는 "Find OCR errors with Claude"(원문의 OCR 오류).

- 누르면 Claude가 그 장을 읽고(읽기 도구만, 쓰기 도구는 아예 없다) 제안 목록을 낸다. 기본 Sonnet 5.5, 5단락에 7초·$0.03 정도.
- 제안은 본문에 맞춤법 표시와 같은 모양(지울 말에 취소선, 넣을 말은 초록)으로 보인다. 본문의 표시를 누르면 패널의 카드가 골라질 뿐이고, 바꾸는 것은 카드의 **Accept**뿐이다. **Dismiss**는 버리기, **Keep as comment**(리뷰만)는 Claude의 댓글로 남기기. 셋 다 ⌘Z로 되돌아간다.
- 그사이 글이 바뀌어 그 구절이 없으면 본문에 그리지 않고 카드의 Accept가 꺼진다. 같은 장을 다시 돌려도 이미 열린 제안과 겹치는 것은 다시 나오지 않는다.
- OCR 제안은 스캔과 대조해 확인한다(Claude는 스캔을 보지 않는다, 글만 받는다).

### Session — 그날의 작업으로 매일 퀴즈

사이드바 아래 **Session**(Glossary 위). 매일 21:00에 서버가 Claude(Opus 5.5)에게 그날 번역이 바뀐 단락 — 번역자의 것과 Claude의 것 — 을 읽혀 카드를 만든다. 배지는 오늘 남은 카드·챌린지 수(사이드바를 접으면 점). 설계와 실측: `docs/session.md`.

- **카드**: 뜻(이 문맥에서 이 표현은?)과 뉘앙스(이 말의 결에 가장 가까운 한국어는?), 보기 넷에 정답 하나 — 서버가 채점하고 이유와 그 단락의 지금 번역을 보인다. **챌린지**(이 번역을 지킬까?)는 번역자가 정한다: Keep it / Use the suggestion(그 구절만 바꾼다, 번역자의 쓰기, ⌘Z) / Discuss with Claude(Translate에서 그 단락을 열고 Claude 상자에 그 말을).
- **한 장씩**: 숫자 1–4로 고르고 ↵. 틀린 카드는 그 회차 끝에 맞을 때까지 다시 나온다. 상자 다섯, 간격 1·2·4·8·16일, 다섯째 상자에서 맞으면 졸업. 상자는 그날의 첫 답만 움직인다. 하루 새 카드 10·챌린지 3, 끝 화면에서 더(10 more, 3 more challenges, 쌓인 게 없으면 Make more from the last 7 days).
- **I know this**: 다시 묻지 않고, 그 표현은 다음부터 고르지 않는다. **Answer looks wrong**: Claude가 정답을 잘못 만들었을 때, 그 카드는 빠진다.
- **재료 더하기**: 원문에서 고른 말은 선택 툴바의 **Add to Session**. 원문 구절을 Claude에게 물어보면 그 말도 자동으로.
- **저녁 실행**: 21:00에 서버가 꺼져 있었거나 맥이 잠들어 있었으면 다음에 켜질 때 한 번. 실패하면 10분 뒤 다시(세 번까지), 그다음은 Session의 Try again. 바뀐 게 없으면 Claude를 부르지 않는다. 한 번에 15센트 안팎, 1분 이내.
- 책 자체(`out/book.db`)를 연 서버만 만든다. 사본을 여는 서버(`--db`: 테스트, e2e)는 만들지 않는다. `--evening on|off`로 바꾸고, 서버가 켜질 때 한 줄로 말한다.
