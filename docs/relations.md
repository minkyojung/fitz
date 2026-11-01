# 관계 — 책의 인물·장소·조직을 선으로 (설계, 2026-11-01)

책을 번역하다 보면 "이 사람이 누구였지", "이 둘이 어떤 사이였지"를 앞 장으로 돌아가 찾는다. Claude가 장을 읽고 관계를
제안하고, 번역자가 승인 카드로 허락하면, 앱이 그 관계들을 그림으로 그린다. 모든 선은 근거 단락을 가리키고, 누르면 그 단락이 열린다.

핵심 한 줄: **Claude는 그림을 그리지 않고 관계 데이터를 쓴다. 배치는 앱이, 결정은 번역자가.**

## 0. 원칙

- **데이터와 보기를 가른다.** 관계는 SQLite의 행이다. 캔버스는 그 행들의 렌더링이다. 좌표는 데이터가 아니다.
- **Claude에게 좌표를 맡기지 않는다.** 모델은 좌표·겹침·정렬을 못 한다. 관계를 말하는 것은 가장 잘한다. 번역문을 쓰지 Tiptap의
  커서를 움직이지 않는 것(`docs/agent.md` §0)과 같다.
- **노드는 용어집이다.** 새 노드 테이블을 두지 않는다. `glossary.term`이 노드, `glossary.kind`(person·place·org·work)가 모양과 색.
  용어집에 없는 것은 잇지 못한다: 관계도와 표기 규칙이 어긋나지 않게.
- **선은 근거가 있어야 한다.** 모든 관계에 `segment_id`가 필수다. 단락이 장에 속하므로 "n장까지의 관계도"가 거저 나온다.
- **쓰기는 `execute()`를 지난다**(§0-1). `ops`에 남고 ⌘Z와 "Claude 변경 되돌리기"로 돌아간다.
- **쓰기 도구는 승인 카드를 거친다**(§3). 검사는 묻기 전에 끝낸다: 허락한 뒤 실패하지 않는다.
- 책은 텍스트로만 간다. 근거는 늘 세그먼트의 원문·번역문이다. PDF와 쪽 이미지는 없다(§0-2).

## 1. 이름

화면은 **관계**(Relations), 테이블은 `relation`, 도구는 `relations`·`set_relation`. 라벨은 자유 문자열이다. 관계의 종류
("형제", "적", "사장")를 미리 정하지 않는다: 책마다 다르고, 쌓인 뒤 정리해도 늦지 않다.

## 2. 데이터

```sql
CREATE TABLE relation (
  id          INTEGER PRIMARY KEY,
  book_id     INTEGER NOT NULL REFERENCES book(id),
  from_term   TEXT NOT NULL,                             -- glossary.term
  to_term     TEXT NOT NULL,                             -- glossary.term
  label       TEXT NOT NULL,                             -- "경영권을 잡았다"
  segment_id  INTEGER NOT NULL REFERENCES segment(id),   -- 근거 단락
  quote       TEXT,                                      -- 그 단락 원문에 정확히 한 번 나오는 구절. NULL = 단락 단위로만
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_relation_segment ON relation(segment_id);
```

- 양 끝은 `glossary`에 있어야 한다(같은 책, `term` 일치). 없으면 거절하고 `set_glossary_term`을 가리킨다.
- `quote`는 댓글의 `makeAnchor`와 같은 규칙: 그 단락 원문에 한 번만. 없거나 둘 이상이면 거절("더 길게 인용하라").
- 같은 (from, to, label, segment)가 이미 있으면 거절한다. 되풀이해 묻지 않게.
- 방향이 있다(from → to). 대칭 관계("형제")도 한 줄로 둔다. 화면이 양쪽 화살표로 그리지 않는다. 단순함이 먼저.
- 노드의 위치(번역자가 끈 자리)는 MVP 뒤에 `relation_layout(book_id, term, x, y)`로. `ops`에 넣지 않는다: 자리 옮김이 ⌘Z에 섞이지 않게.

명령(`server/commands.mjs`, 되돌리기 가능):

| 명령 | 역 | 메모 |
|---|---|---|
| `addRelation { id?, bookId, fromTerm, toTerm, label, segmentId, quote? }` | `removeRelation { id }` | 검사: 용어 둘, 단락, 인용 한 번, 중복 |
| `removeRelation { id }` | `addRelation { 그 행 }` | |

`segment_ids`에 근거 단락을 넣어 이력 조회와 되돌리기 겹침 판정(`touches`)이 그것을 안다.

## 3. 도구 (MCP 서버 `fitz`, §3에 더함)

| 도구 | 종류 | 모델의 질문 | 인자 | 돌려주는 것 |
|---|---|---|---|---|
| `relations` | 읽기 | "지금까지 알려진 관계가 뭐지?" | `chapterId?`(그 장까지의 근거를 가진 것만), `term?`(그 용어가 한쪽 끝인 것만) | `{ relations: [{ id, from, to, label, segmentId, chapterId, quote }] }` |
| `set_relation` | 쓰기 | "이 관계를 기록해도 될까?" | `fromTerm, toTerm, label, segmentId, quote?` | `{ id }` |

- `relations`는 노드를 돌려주지 않는다. 노드는 `glossary`가 이미 준다.
- `set_relation` → `addRelation`. 승인 카드(`describeWrite`): `{ summary: "A → B: 라벨", segmentId, quote, chapter }`.
  쓰기 도구의 공통 손댈 곳은 §34 끝 문단과 같다: `tools.mjs`(`WRITE_TOOL_NAMES`, `describeWrite`), `session.mjs`의 `SYSTEM_PROMPT`,
  화면 `trace.ts`(`WRITE_TOOLS`)·`Thread.tsx`(아이콘), §3 표, `README.md`.
- Claude의 흐름: `relations`로 있는 것을 읽고 → `read`로 장을 읽고 → 새 것만 `set_relation`. 프롬프트에 그렇게 쓴다.
- 지우는 도구는 두지 않는다. ⌘Z와 되돌리기로 된다(§34의 주석·댓글과 같은 판단). 번역자가 지우는 것은 화면에서(MVP 뒤).

## 4. 화면 — 참조 칸의 탭 (갤러리 `?gallery&reference`로 정함, 2026-11-01)

페이지가 아니라 **왼쪽 참조 칸의 Relations 탭**이다(`docs/agent.md` §35: Scan · Glossary · Relations). 본문에는 늘 단락이 있고, 그래프는 그 옆에 있다.

- **그래프.** React Flow(`@xyflow/react`, MIT). 노드 = 용어집(관계가 하나라도 걸린 것만), 색 = kind(본문의 용어 표시와 같은 색). 선 = 관계, 라벨 표시.
  배치는 ELK(`elkjs`, layered, 위→아래)가 자동으로. 좁은 칸이라 확대율 0.9 아래로 줄이지 않고 끌어서 본다.
- **본문과 잇기.** 단락을 고르면 그 단락이 근거인 선이 밝아지고 나머지는 흐려진다. 선의 라벨을 누르면 본문이 그 단락으로 간다(`jumpTo`). 근거 패널은 없다: 본문이 근거다.
- **단락 머리줄.** 관계가 걸린 단락은 머리줄에 수가 붙고, 누르면 Relations 탭이 열린다.
- 데이터는 `GET /relations`(책 전체) 하나. 변경은 `/live`의 변경 알림(`watchChanges`)으로 다시 받는다. Claude가 쓴 선이 열어 둔 화면에 바로 나타난다.
- 노드를 끌어 옮기면 그 위치는 저장하지 않는다(MVP). 다시 열면 자동 배치.

## 5. 번역자가 겪는 것 (MVP)

1. **말한다.** Claude 탭에 "3장 인물 관계 정리해줘". Claude가 읽고, 승인 카드가 하나씩 뜬다:
   ```
   관계 추가
   Samuel Zemurray  →  United Fruit
   "경영권을 잡았다"
   근거: 3장 42단락  "…Zemurray took control of United Fruit in 1933…"
   [허락]  [거절]
   ```
   허락하면 저장. 틀리면 거절. 새로 배울 동작이 없다.
2. **본다.** 참조 칸(⌘I)의 Relations 탭. 용어들이 카드로 떠 있고 허락한 선이 그들을 잇는다. 배치는 이미 되어 있다.
3. **확인한다.** 본문의 단락을 고르면 그 단락의 선이 밝아진다. 선을 누르면 본문이 그 단락으로.
4. **직접 만든다.** 원문에서 구절을 긋고 선택 툴바의 **Add relation**. 그 단락과 인용이 근거로 미리 채워진 작은 양식에서 양쪽 용어를 고르고 라벨을 쓴다.
   Ask Claude(⌘L)·댓글 달기와 같은 자리, 같은 손놀림. 양쪽 용어는 용어집에서 고른다(없으면 먼저 Add to glossary). 번역자의 쓰기(`actor = translator`), ⌘Z.
5. **지운다.** 선의 라벨을 우클릭 → Remove. ⌘Z로 돌아온다.

한 줄로: **말하면 카드가 뜨고, 허락하면 그림이 생기고, 단락을 고르면 선이 밝아지고, 번역자도 긋고 지울 수 있다.**

## 6. MVP 범위

들어가는 것: `relation` 테이블과 명령 둘, 도구 둘(승인 카드), `GET /relations`와 변경 알림, 참조 칸의 Relations 탭(자동 배치, 단락↔선 잇기), 선택 툴바의 Add relation, 선 우클릭 Remove.

안 들어가는 것: 장 슬라이더, 종류 필터, 노드 위치 저장, 그래프에서 끌어 잇기, 라벨 고치기(지우고 다시 만든다), 고른 노드를 Claude에 붙이기, 지우는 도구(Claude는 ⌘Z로).

## 7. 만드는 순서 (행 = 커밋)

§35의 2–4행(참조 칸, Glossary 탭, Export 대화상자)이 먼저다. 그 위에:

| # | 무엇 | 손댈 곳 | 확인 |
|---|---|---|---|
| 1 | 이 문서 | `docs/relations.md` | |
| 2 | 테이블, `addRelation`·`removeRelation`, `listRelations` | `db/schema.sql`(+ 기존 DB에 `CREATE TABLE IF NOT EXISTS`), `commands.mjs`(`COMMANDS`, `touches`) | `commands.test`: 용어 없음·단락 없음·인용 0회/2회·중복 거절, ⌘Z/redo, `ops.segment_ids` |
| 3 | `relations`, `set_relation` | `tools.mjs`, `session.mjs`(프롬프트: 읽고 → 새 것만), `trace.ts`·`Thread.tsx`, §3 표·README | `tools.test`: 카드 전후, 거절은 묻기 전에, `chapterId`·`term` 필터, 쪽 이미지·경로 없음. `real.test`: 도구 15개 |
| 4 | `GET /relations`, `POST /relations`, `DELETE /relations/:id`, 변경 알림 | `index.mjs`, `live.mjs`, 화면 `data/api.ts`·`http.ts`·`useBook.ts` | `index.test`, `live.test` |
| 5 | Relations 탭(React Flow + ELK), 단락↔선 잇기, 단락 머리줄의 수 | `features/reference/RelationsGraph.tsx`, `PairRow.tsx`·`SegmentRow.tsx` | e2e: Claude가 쓴 선이 보이고, 단락을 고르면 밝아지고, 라벨을 누르면 그 단락 |
| 6 | 선택 툴바의 Add relation, 선 우클릭 Remove | `FloatingToolbar.tsx`, `RelationsGraph.tsx` | e2e: 구절 긋고 만들기, 지우기, ⌘Z |
| 끝 | 전부 | | server·unit·types·lint·e2e |

**결과**(2026-11-01): 2–6행 전부. 명령의 검사는 `checkRelation` 하나에 있어 `addRelation`과 승인 카드(`describeWrite`)가 같은 것을 본다. 선택 툴바의 Add relation은 고른 글자가 단락에 한 번이면 그것을 `quote`로, 두 번 이상이면 단락만 근거로 보낸다(거절 대신). 그래프는 Relations 탭을 처음 열 때 실린다(lazy). 서버 304(+실제 6 건너뜀), 화면 단위 74, pipeline 38, e2e 76 중 72(실패 넷은 이 작업 전부터, §35 결과). 마이그레이션은 `pipeline.migrate`가 `relation` 테이블을 만든다; 이 작업 폴더의 `out/book.db`에는 적용했다(백업 `out/book.db.bak-2026-11-01-before-relation`).

## 8. 참고 — 왜 React Flow이고 왜 Arky를 봤나

**tldraw가 아닌 이유.** tldraw는 좌표가 진실인 화이트보드다(자유 도형, 손그림, 화살표는 도형에 바인딩되는 별도 도형). 자동 배치가 없고,
사람이 놓는 것이 전제다. 무료는 워터마크, 제거는 상용 라이선스. React Flow는 `nodes`·`edges` 두 배열이 진실이고, 노드가 React 컴포넌트이며,
dagre·ELK·d3-force를 붙이는 것이 공식 패턴이고, MIT다. 책의 정보 관계는 "구조가 있는 데이터를 보여주는 판"이라 후자다.
번역자가 자기 생각을 자유롭게 펼치는 메모판이 필요해지면 그때 tldraw를 다시 본다. 그때도 Claude가 조작하게 하지는 않는다.

**Arky**(arky.so, Arky Labs·서울, 1.0 2026-05, 조사 2026-11-01)에서 확인한 것:
- 한 데이터(Shell 계층), 세 보기(캔버스·문서·마인드맵). "구조는 데이터, 캔버스는 보기"와 같은 결론.
- AI는 "Shell 카드"를 만들고 사람이 끌어다 놓는다. 자동 배치는 체인지로그에 없다. AI에게 좌표를 맡기지 않는다.
- 0.4(2026-02): Shell 사이의 화살표를 AI가 읽는다. → 번역자가 그은 선도 `relations`로 Claude가 읽어야 한다.
- PDF 옆 뷰어와 자동 인용, 1.5의 구절 선택. → 우리의 "선을 누르면 근거 단락". 단, fitz는 PDF를 모델에 주지 않는다.
- 고른 Shell·블록·글자를 ⌘+J로 채팅에 칩으로 붙인다. → MVP 뒤의 "고른 노드를 Claude에 붙이기".
- 다른 점: Arky는 사람이 구조의 저자(백지). fitz는 책이 구조의 저자. 그래서 자유 캔버스가 아니라 용어집 노드 + 근거 있는 선으로 좁힌다.
