# fitz 번역 하네스 — 설계 (2026-10-18)

fitz는 번역 중인 책에 대해 일하는 Claude Code의 하네스다. Octave가 저장소에 대해 그렇듯이. 번역자가 단어와 뉘앙스를 묻기 위해 에디터 밖으로 맥락을 복사해 나가는 일을, Claude Code에게 책을 읽고 쓰는 도구를 주어 없앤다.

**기준 하나:** Claude Agent SDK가 이미 주는 것은 그대로 쓴다(세션, 스트리밍, 도구 실행 루프, 권한 묻기, hook, 구조화 출력, 비용 상한, 컨텍스트 압축). 없는 것만 짓는다(책을 다루는 도구, 번역 검증, 화면).

버전: `@anthropic-ai/claude-agent-sdk` **0.3.302**(고정), 동봉 바이너리 Claude Code 2.1.302, `zod` 4, `ws` 8.

## 0. 원칙

1. **모든 쓰기는 `server/commands.mjs`의 `execute()`를 지난다.** 에이전트의 수정도 ops 로그에 남고 ⌘Z로 돌아가며 `segment_version`에 스냅샷된다. 새 쓰기 경로를 만들지 않는다.
2. **텍스트만 나간다.** `tools: ["WebSearch"]`로 내장 도구를 웹 검색 하나로 좁혀 파일·페이지를 여는 것(Read·Edit·Bash·WebFetch)을 전부 떼므로 PDF와 쪽 이미지를 읽을 손이 모델에게 없다. 웹 검색으로 나가는 것은 검색어뿐이다(번역자 확인, 2026-10-19). 규칙이 아니라 구조로 지킨다. 도구 결과에 `image_path`·`source_pdf`·`boxes`가 없음을 테스트가 단언한다.
3. **모델의 말은 증거가 아니다.** 번역이 끝났다는 판단은 앱의 검증(`checks`)이 한다. 결과는 앱이 기록한다.
4. **상태 승격은 사람만.** 에이전트는 `draft`까지만 쓴다. `reviewed`·`final`은 사람이 ⌘Enter로.
5. **제안과 결정을 가른다.** 리뷰·오탈자 작업에는 쓰기 도구를 주지 않는다. 결과는 카드이고 수락은 클릭이다.

## 1. SDK에서 쓰는 것과 이유

| 옵션 | 값 | 왜 |
|---|---|---|
| `tools` | `["WebSearch"]`, 작업 대화는 `[]` | 내장 도구는 웹 검색만. 원칙 2. 리뷰·오탈자는 책 안에서 찾는 일이라 웹이 없다 |
| `mcpServers` | `{ fitz: createSdkMcpServer({ name: "fitz", tools }) }` | 앱 프로세스 안에서 도는 MCP. 도구 이름은 `mcp__fitz__<name>` |
| `allowedTools` | `mcp__fitz__book`, `__read`, `__glossary`, `__search`, `WebSearch`(대화만) | 읽기와 웹 검색은 묻지 않는다. 쓰기는 `canUseTool`로 온다 |
| `canUseTool` | 쓰기 도구 → host의 `ask`(번역자에게 묻는다), 그 밖 → 거절 | 답: 허락 / 이 세션 동안 항상(`addRules` + `destination: "session"`) / 거절. Claude Code가 제안하는 "항상" 규칙은 `localSettings` 파일에 적혀 대화가 끝나도 남으므로 쓰지 않는다 |
| `permissionMode` | `"default"` | bypass가 아니다. 쓰기는 물어야 한다 |
| `systemPrompt` | 문자열, 대화는 `SYSTEM_PROMPT`, 작업은 `TASK_SYSTEM_PROMPT` | 코딩용 preset 불필요. 번역 하네스 프롬프트로 교체. 작업에는 웹·쓰기 도구가 없어 그 말도 없다(§20) |
| `settingSources` | `[]` | 사람의 `~/.claude`(CLAUDE.md·hook·MCP)가 섞이지 않는다 |
| `strictMcpConfig` | `true` | 여기서 준 MCP 서버만. §8 |
| `settings` | `{ disableClaudeAiConnectors: true, autoMemoryEnabled: false, disableBundledSkills: true }` | `settingSources`가 닿지 않는 것: claude.ai 커넥터, 자동 메모리, 기본 스킬. §8 |
| `skills` | `[]` | 사람의 스킬 목록이 모델에게 가지 않는다. 생략하면 "끔"이 아니라 CLI 기본값 |
| `cwd` | 빈 폴더 `~/.fitz/agent/` | 세션 파일이 저장되는 키이자, 저장소·PDF 경로와 분리 |
| `includePartialMessages` | `true` | 글자 단위 스트리밍 |
| `extraArgs` | `{ "replay-user-messages": null }` | 보낸 메시지의 메아리(uuid 포함). 기본은 꺼짐(측정) |
| `prompt` | `AsyncIterable<SDKUserMessage>` (streaming input) | 대화 1 = `query()` 1. 여러 턴, `interrupt()`, `setModel()` |
| `resume` | 세션 id | 서버·앱 재시작 뒤 이어가기. 지난 메시지는 `getSessionMessages()`로 |
| `hooks.Stop` | 검증 게이트 | `{ decision: "block", reason }`로 같은 턴 안에서 되돌림 |
| `outputFormat` | `{ type: "json_schema", schema }` | 리뷰·오탈자의 결과. `result.structured_output` |
| `maxBudgetUsd`, `maxTurns` | 작업마다 | 상한 |
| `model`, `effort`, `thinking` | 명시 | 번역 `opus`/`medium`, 리뷰·오탈자 `sonnet`/`low`, `{ type: "adaptive" }` |
| `env` | `{ ...ownEnv(process.env), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" }` | `env`를 주면 통째로 바뀌므로 펼쳐서(`USER`가 없으면 로그인을 못 찾는다). `ownEnv`는 부모 Claude Code 세션이 물려준 변수를 뺀다. §8 |
| `stderr` | `[claude]`를 붙여 서버 stderr로 | 바이너리가 말하는 것을 잃지 않는다 |
| `tool()`의 `extras` / `createSdkMcpServer` | 읽기에 `{ annotations: { readOnlyHint: true } }`, 서버에 `alwaysLoad: true` | 읽기 도구는 병렬로 돈다. `alwaysLoad`로 `ToolSearch` 왕복을 없앤다 |

**인증.** SDK가 띄우는 바이너리는 환경에 `ANTHROPIC_API_KEY`가 있으면 묻지 않고 그 키를 쓰고, 없으면 Keychain의 Claude 로그인(이 Mac: Max)을 쓴다. 서버는 시작 시 `claude auth status`로 어느 자격으로 도는지 로그에 밝힌다. 약관(code.claude.com/docs/en/legal-and-compliance): 수정하지 않은 바이너리에 본인 구독으로 직접 로그인하는 것은 허용되며, Pro/Max 한도는 "Claude Code와 Agent SDK의 통상적 개인 사용"을 전제한다. 금지되는 것은 개발자가 자기 제품의 사용자들에게 claude.ai 로그인을 제공하거나 사용자 대신 구독으로 중계하는 것이다. fitz는 단일 사용자 로컬 도구다.

## 2. 구조

```
server/
  index.mjs             기존 JSON 라우트 그대로 + 화면과의 실시간 연결(live.mjs)
  live.mjs              WebSocket /live: 대화와 책 변경 알림. agent/protocol.mjs로 검사하고 host에 넘긴다(§15)
  commands.mjs          COMMANDS · execute · undo · redo  — 그대로. 에이전트의 모든 쓰기가 지난다
  agent/
    tools.mjs           MCP 도구 8개(읽기 4, 쓰기 4) = 기존 commands의 얇은 포장
    session.mjs         query() 옵션 전부 명시. claude를 띄우는 유일한 파일
    fold.mjs            SDK 프레임 → 대화 상태. 순수 함수. 페이지도 같은 함수를 쓴다
    host.mjs            서버의 대화들: 대화마다 세션 하나, 접은 상태, 따라가는 쪽. 소켓을 모른다
    chat.mjs            터미널에서 에이전트와 대화(페이지와 같은 소켓, 같은 fold)
    record.mjs          실제 한 턴을 녹화(JSONL)하는 개발용 스크립트. 세션은 임시 폴더에서 돌고 지워진다
    fixtures/           gatsby.sql(퍼블릭 도메인 책) + 녹화. 커밋하는 녹화에 번역 중인 책은 들어가지 않는다
    checks.mjs          앱이 돌리는 번역 검증. 순수 함수
    protocol.mjs        ClientMsg / ServerMsg 닫힌 union. 수신 시 모든 필드 검증
app/src/
  lib/live.ts           페이지의 실시간 연결 하나(다시 붙기, resync). 9단계의 대화 화면도 이 위에
  features/agent/       오른쪽 Claude 패널(§17, §22): 스레드, 라이브 라인, 승인 카드, 결과 카드, 비용
```

## 3. 도구 (MCP 서버 `fitz`)

도구는 라우트 하나에 하나가 아니라 **모델이 묻는 질문 하나에 하나**다. 8개: 읽기 4, 쓰기 4. Claude Code에 빗대면 `book` = `ls`, `read` = `Read`, `search` = `Grep`, `glossary` = 프로젝트의 규칙 파일.

읽기 — `readOnlyHint`, `allowedTools`, 묻지 않음, 병렬로 돈다:

| 도구 | 하는 일 | 인자 | 돌려주는 것 | 기존 코드 |
|---|---|---|---|---|
| `book` | 책과 차례 | — | `{ id, title, author, chapters: [{ id, idx, title, startPage, segmentCount, confirmedCount }] }` | `getBook`, `listChapters` |
| `read` | 단락 읽기. 주석·댓글·걸린 용어를 함께 싣는다 | `ids[]` 또는 `chapterId` 중 하나, `around`(ids가 하나일 때 앞뒤 n단락), `from`(chapterId와 함께, `next`로 받은 값) | `{ segments: [{ id, chapterId, idx, kind, pageStart, pageEnd, status, version, sourceText, targetText, notes, comments, terms }] }` | `segRow`, `noteRow`, `commentRow`, 앱의 `findTerms` 규칙 |
| `glossary` | 책 전체 표기 규칙 | — | `{ terms: [{ term, translation, aliases, kind, occurrences }] }` | `listGlossary` |
| `search` | 책 전체 원문 검색(대소문자 구분, 글자 그대로) | `query` | `{ hits: [{ segmentId, chapterId, chapterTitle, pageStart, count, snippet }] }` | `search` |

- `read`가 주석·용어를 동봉하므로 단락 하나를 번역하는 데 읽기 호출은 1번이다.
- `read`는 한 번에 글 2만 자(`READ_BUDGET`, 원문+번역+주석+댓글)까지 돌려주고, 남으면 `next`(다음 호출의 인자 그대로)를 준다. 단락 하나는 예산을 넘어도 돌려준다. 이유는 §8의 출력 한도.
- 평문만 준다. `source_doc`/`target_doc`(JSON), `ocr_text`, `boxes`(좌표), `image_path`, `source_pdf`는 어떤 도구 결과에도 없다.
- `version`은 쓰기 도구의 `expectVersion`으로 되돌려 받는다(§12).

쓰기 — `canUseTool`로 묻는다. 전부 `execute()`:

| 도구 | → 명령 | 메모 |
|---|---|---|
| `set_translation(segmentId, text, expectVersion)` | `updateSegment { targetDoc, status: "draft", expectVersion }` | 그사이 단락이 바뀌었으면(번역자가 편집 중일 수 있다) 409로 거절되고 다시 읽는다. 에디터의 저장과 같은 검사(§12) |
| `set_glossary_term(term, translation, aliases?, kind?)` | `setGlossaryTerm` | |
| `add_comment(segmentId, side, body, quote?)` | `addComment` | `quote`가 있으면 `makeAnchor`로 앵커 |
| `add_translator_note(segmentId, body, quote?)` | `addNote` | |

- `set_translation`은 늘 `status: "draft"`로 쓴다. reviewed·final이던 단락도 draft로 내려간다(미리보기가 그렇게 말한다). 확정은 사람만.
- 쓴 쪽은 들어온 문으로 정해진다(§16): fitz 도구의 쓰기는 `ops.actor = agent`와 그 도구 호출 id로 기록되고, Claude의 댓글은 `comment.author = agent`(화면에 "Claude" 표시). 역주는 출판될 글이라 표시하지 않지만 출처는 `ops`에 남는다.
- `quote`는 그 쪽 글에서 한 번만 나와야 한다. 없거나 두 번 이상이면 거절("더 길게 인용하라").
- 미리보기(`describeWrite`): `{ summary, segmentId, before, after }`. 번역자는 무엇이 어떻게 바뀌는지 보고 답한다. 쓰기가 할 검사(버전, 인용구, 빈 글)를 먼저 하므로, 실패할 쓰기는 묻지 않고 바로 거절한다 — 번역자가 허락한 뒤에 실패하는 일이 없다.
- 쓰기 넷을 하나로 합치지 않는다. 본문을 바꾸는 것, 책 전체 표기를 바꾸는 것, 출판되지 않는 메모, 출판되는 역주는 승인 카드에서 무게가 다르다.
- 결과는 `structuredContent`(객체)로 돌려준다. 모델은 그 JSON을 받는다.
- 오류는 던지지 않고 `isError: true`로 모델이 읽을 문장을 준다.
- `pmDoc`(평문 → 문단 1개 doc)은 이미 있다. 여러 블록은 줄바꿈으로 가른다(`docText`의 역).

## 4. 작업 셋 — 프롬프트와 `outputFormat`만 다르다

| 작업 | 입력 | 도구 | 끝 |
|---|---|---|---|
| **번역** | 세그먼트 id들(선택 단락 또는 장) | 읽기 + `set_translation` (+ 용어 등록) | Stop hook이 `checks`를 돌린다 → 실패분을 되돌려 보낸다(TRIES = 3) → 통과해도 `draft`. 사람이 reviewed |
| **리뷰** | 장(번역된 단락) | 읽기만 | `outputFormat` → 제안 목록 → 번역문에 제안 표시 + 패널 카드, 사람이 Accept / Dismiss / Keep as comment |
| **오탈자** | 장 | 읽기만 | `outputFormat` → 제안 목록 → 원문에 맞춤법 표시와 같은 모양 + 패널 카드, 사람이 Accept / Dismiss |

자유 질문("이 단락 뉘앙스는?")은 어느 스레드에서나 가능하다. 도구는 읽기만.

리뷰·오탈자 대화(`tasks.mjs`): 앱이 장 하나로 시작하면 서버가 첫 메시지를 바로 보낸다. 기본 모델 Sonnet 5.5 / low, 상한 60턴·$5(실측은 §4.2 5행 아래). 다시 열어도 같은 작업으로 이어진다.

### 4.1 리뷰·오탈자의 화면 — 익숙한 제품을 따른다 (7단계 설계, 2026-10-18)

갤러리: `?gallery&suggestions`(`app/src/gallery/SuggestionsGallery.tsx`, 예문은 『위대한 개츠비』).

| 기능 | 닮은 것 | 화면 | 사람이 하는 것 |
|---|---|---|---|
| 리뷰 | 구글 독스 제안 모드 + Grammarly 목록 | 번역문의 그 구절에 취소선 + 초록 제안(맞춤법 표시와 같은 diff 표현), 패널 **Suggestions** 탭에 카드(¶, 중요도, 구절 → 제안, 이유) | **Accept**(번역문이 바뀜, ⌘Z) / **Dismiss** / **Keep as comment**(못 정한 것을 Claude의 댓글로) |
| 오탈자 | 워드의 맞춤법 밑줄 | 원문에 지금의 맞춤법 표시와 **같은 모양**. 사전이 찾는 것(없는 단어)과 Claude가 찾는 것(문맥상 틀린 실제 단어: reverse→reserve, boars→bores)이 나란히 | **Accept** / **Dismiss**. 확인은 검수 화면의 스캔과 대조해서(Claude는 스캔을 보지 않는다) |

**본문은 보여 주기만, 결정은 패널에서**(댓글과 같은 방식): 본문의 제안 표시를 누르면 Suggestions 탭의 그 카드가 선택되고, 카드를 누르면 본문의 그 자리가 강조된다. Accept·Dismiss·Keep as comment는 카드의 버튼으로만 — 본문 클릭으로는 아무것도 바뀌지 않는다. 사전 맞춤법 표시(지금 있는 기능)는 그대로 둔다.

원칙: Claude는 찾기만 한다(두 작업에는 쓰기 도구가 없다). 책이 바뀌는 것은 사람이 누를 때뿐이고, 그 쓰기는 사람의 것(`actor = translator`)이다. 패널 맨 위 한 줄이 시작·진행·끝을 보인다("Review this chapter with Claude" → "Claude is reading the chapter…" → "3 suggestions").

### 4.2 만드는 순서 (행 = 커밋)

| # | 무엇 | 파일 | 확인 |
|---|---|---|---|
| 0 ✓ | **먼저 잰다**: `outputFormat`이 `tools: []`·streaming input과 함께 도는가(구조화 출력이 지운 내장 도구에 기대지 않는가), `structured_output`이 어디에 오고 세션 파일에 남는가 | 임시 스크립트(Haiku) | 결과를 §8에 기록, 아래 3의 저장 방식을 정한다 |
| 1 ✓ | 작업 정의: 두 작업의 지시문, 범위(장)로 만든 첫 메시지, 결과의 JSON 스키마(zod → draft-07) | `server/agent/tasks.mjs` 새로 | 순수 테스트 |
| 2 ✓ | 작업별 세션: 작업 대화는 읽기 도구만 + `outputFormat` + 상한(`maxTurns`, `maxBudgetUsd`). `start { convId, task, chapterId }` | `session.mjs`, `tools.mjs`(쓰기 도구를 뺀 서버), `host.mjs`, `protocol.mjs` | 스텁 세션 테스트 |
| 3 ✓ | 제안 저장: `agent_suggestion`(대화, 종류, 단락, 쪽(원문/번역), 구절, 제안, 이유, 중요도, 그때의 단락 버전, 상태 open·accepted·dismissed·commented). 결과가 오면 구절이 그 글에 정확히 한 번 있는 것만 저장(바꾸는 것이 없거나, 열린 제안과 겹치면 — 같은 장을 다시 돌린 경우 — 저장하지 않는다) | `db/schema.sql`, `pipeline/migrate.py`, `server/agent/suggestions.mjs` 새로 | 순수 테스트, 작업 DB 백업 후 마이그레이션 |
| 4 ✓ | 제안 다루기: 명령 하나 `decideSuggestion`(accept·dismiss·comment) — 결정과 그 결정이 한 일을 한 걸음으로 남겨 ⌘Z 한 번에 둘 다 돌아온다. Accept = 지금 글에서 구절을 다시 찾아(정확히 한 번이 아니면 409 "글이 바뀜") 그 자리만 바꾼다(첫 글자의 표시를 이어받음, 번역자의 쓰기) / Dismiss / Keep as comment = Claude의 댓글(`author: agent`, 구절이 없어졌으면 단락에). 결정은 다른 쓰기처럼 `changed`로, 새 제안은 `suggested { segmentIds }`로 알린다 | `commands.mjs`(명령·목록), `suggestions.mjs`(알림), `index.mjs`(경로 둘: `listSuggestions`, `decideSuggestion`), `live.mjs` | 서버 테스트 + 실제 HTTP |
| 5 ✓ | 진짜로 한 번: 두 작업을 Gatsby로 녹화(`record.mjs --task`), `pnpm test:real`에 "스키마에 맞고 구절이 글에 있는 제안이 온다" | `record.mjs`, `real.test.mjs`, `fixtures/` | 실측 기록 |

**5행 실측**(2026-10-18, Sonnet 5.5 / low, `fixtures/gatsby-tasks.sql`: 원문에 OCR 오류 넷 — tuming·matures(실제 단어)·rnind·unjust1y — 과 오류 아닌 것 하나(Fitzgerald의 "any one"), ¶4 번역에 뜻을 뒤집은 "모든 판단을 서둘러 내리는"):

| 작업 | 도구 호출 | 시간 | 비용 | 결과 |
|---|---|---|---|---|
| 오탈자 | `read({chapterId:1})` 1회 → `StructuredOutput` | 6.0초, 3턴 | $0.022 | 넷 다 찾고 넷 다 저장, "any one"은 건드리지 않음 |
| 리뷰 | `read` → `glossary` → `StructuredOutput` | 7.3초, 4턴 | $0.025 | ¶4 "서둘러 내리는" → "유보하는", high. 이유에 번역자의 댓글(reserved와의 말장난)까지 반영 |

녹화 둘이 테스트가 된다: 다시 읽은 대화 = 실시간 대화(`fold.test`), 쓰기 도구 없음(`session.test`), 진짜 답이 그대로 저장됨(`host.test`). `pnpm test:real`(Haiku)의 오탈자 실행 8.8–10.7초. 상한(60턴·$5)은 폭주를 막는 값이다.
| 6 ✓ | 화면의 데이터: 제안 타입·경로, `/live`로 작업 시작(보내기 + 대기열은 이때 `lib/live.ts`에). 페이지의 연결은 하나를 같이 쓴다. 작업의 진행(달리는 중·끝·실패)은 대화의 사건에서 읽는다(`lib/taskRun.ts`, 다시 붙으면 `open`으로 다시 따라가 스냅숏이 그사이 끝났는지 말한다) | `app/src/data/api.ts`, `http.ts`, `lib/live.ts`, `lib/taskRun.ts`, `useBook.ts` | 단위 테스트 |
| 7 ✓ | 화면: 패널 **Suggestions** 탭(시작 줄, 카드), 번역문·원문의 제안 표시(맞춤법 표시 코드를 함께 쓴다) | `features/suggestions/` 새로, `ReviewPanel.tsx`, `PairRow.tsx`, `SegmentRow.tsx`, `SourceText.tsx`, `App.tsx`, `lib/suggestions.ts` | e2e: 제안을 e2e DB에 넣고 Accept·Dismiss·Keep·⌘Z·"글이 바뀐 제안" |

**7행 결과**(2026-10-18): 보기가 작업을 정한다 — Translate에서는 리뷰(번역문), Review에서는 오탈자(원문). 본문의 표시는 고르기만 하고(댓글처럼 `SuggestionsContext`, 고르면 Suggestions 탭이 열림), 결정은 카드의 버튼으로만. 고른 것은 같은 색이 진해질 뿐 테두리가 없다. 같은 낱말에 사전 표시와 Claude의 제안이 겹치면 Claude의 것을 보인다. 글이 바뀌어 구절이 정확히 한 번 있지 않은 제안은 본문에 그리지 않고, 카드에 "the paragraph changed since"와 함께 Accept를 끈다(Dismiss·Keep은 된다). 패널이 좁으면(기본 20%) 탭 다섯이 한 줄에 들어가지 않아 두 줄로 접힌다. 시작 줄의 실행은 `/live`를 가로채 흉내 낸다(Claude 없이). e2e 37(새 5), 두 번 연속 통과. `StructuredOutput` 줄 숨기기는 대화 화면(9단계)에서 — 지금은 대화를 보이는 화면이 없다.
| 8 ✓ | README, 이 문서에 결과 | | |

## 5. 검증 (`checks.mjs`)

`checkSegments(db, ids)` → `{ segmentId, kind, detail }[]`, `kind ∈ missingTerm | emptyTarget | ratio | unplacedNote`.
`lib/glossary.ts`의 `missingTerms`, `lib/footnotes.ts`의 미배치 판정과 같은 규칙을 서버에서 다시 쓴다(공유 모듈로 뺄지는 2단계에서 결정).

Stop hook은 fail-open이다(던지거나 시간이 지나면 `{}`로 취급되어 턴이 끝난다). 그러므로 **검증 결과는 hook이 아니라 앱이 `agent_turn`에 기록한 것이 진실**이고, 화면은 그것을 그린다. 되돌림 횟수는 앱이 센다(SDK의 `stop_hook_active`·8회 무시 카운터는 쓰지 않는다).

## 6. 세션과 기록

- 대화 1개 = `query()` 1개(streaming input). 서버가 `Map<convId, { q, sessionId, state }>`.
- `result`마다 `{ convId, sessionId, userUuid, reason, ms, cost, checks }`를 SQLite `agent_turn`에 쓴다. 세션 파일에는 `result`가 없다(측정).
- 서버 재시작 → `resume: sessionId`. 지난 메시지는 `getSessionMessages()`로 읽어 같은 `fold`로 상태를 만든다. 세션 파일을 직접 파싱하지 않는다("scripts that parse these files directly can break on any release").
- 세션은 30일 뒤 Claude Code가 지운다. 번역 스레드의 보존 가치가 드러나면 사본을 둔다(2단계).
- 사람이 에디터로 같은 세그먼트를 고치는 동안 에이전트가 쓰려 하면 `expectUpdatedAt` 불일치로 거절 → 모델이 다시 읽는다.

## 7. 프로토콜 (WebSocket `/live`)

`agent/protocol.mjs`가 정본이다. 지금(4단계) 있는 것:

```
page → server  start { convId, model?, effort? }   대화를 만든다. convId는 페이지가 만든 uuid. 만든 소켓은 그 대화를 따라간다
               open  { convId }                    대화를 따라간다: 지금의 snapshot, 그 뒤의 message 전부
               send  { convId, text }              번역자의 메시지(20,000자까지)
               stop  { convId }                    도는 턴을 멈춘다
server → page  snapshot { convId, state }          fold.mjs의 상태. 따라가기 시작할 때, 그리고 프로세스가 죽어 반쯤 쓴 턴을 버렸을 때
               message  { convId, message }        SDK 메시지 그대로. 페이지가 snapshot 위에 같은 fold로 접는다
               error    { convId?, message }
```

5단계에서 더한 것:

```
page → server  answer { convId, requestId, decision }   allow | always(이 세션 동안 이 도구) | deny
server → page  ask    { convId, ask }                   { requestId, tool, input, preview } — 번역자의 답을 기다리는 쓰기
               asked  { convId, requestId, decision }   답해짐. "cancelled": 답하기 전에 턴이 멈췄거나 프로세스가 끝남
               snapshot에 asks                          따라가기 시작할 때 기다리는 쓰기가 있으면 함께
```

7단계: `start`의 `task`.

§21: `configure { convId, model?, effort? }`(→, 답하는 중이면 409, 작업이면 400) · `configured { convId, model, effort }`(←, 따라가는 모든 페이지에) · `snapshot`에 `model`, `effort`(다음 메시지가 갈 곳).

- **서버 전체가 이 컴퓨터 전용이다**(`origin.mjs`, 2026-10-18): HTTP와 `/live` 모두 처리 전에 Origin이 이 컴퓨터의 페이지(또는 없음)이고 Host가 localhost·127.0.0.1·[::1]인지 본다. CORS 헤더는 `*`가 아니라 그 Origin만. 이유: 브라우저는 어느 사이트에서든 localhost로 요청을 보낼 수 있고, CORS만 막으면 응답을 못 읽을 뿐 다른 사이트의 "단순" POST(text/plain)는 실행된다(쓰기). Host 검사는 남의 도메인을 127.0.0.1로 돌리는 DNS 리바인딩을 막는다(쪽 이미지 포함). 시험: `index.test.mjs`가 실제 서버를 띄워 다른 사이트의 단순 POST가 403이고 아무것도 지우지 않음, 리바인딩 403, 로컬 페이지 200 + 그 Origin의 CORS를 확인한다 — 검사를 끄면 셋이 실패한다.
- 닫힌 union. 다른 모양은 이유와 함께 `error`로 거절하고 소켓은 열어 둔다. 서버는 페이지가 보낸 어떤 필드도 믿지 않는다(알려진 필드만 골라 검사한 뒤 쓴다).
- **이 컴퓨터의 페이지만 붙는다**(`localOrigin`): Origin이 `localhost`·`127.0.0.1`·`[::1]`이거나 없을 때(터미널 `chat.mjs`, 테스트). 브라우저는 어느 사이트에서든 `ws://localhost`를 열 수 있어서, 막지 않으면 아무 웹사이트나 에이전트를 부려 책을 읽어 갈 수 있다. 메시지 하나는 256KB까지.
- 대화는 서버(`agent/host.mjs`)가 들고 있다. Claude Code는 **첫 메시지에서** 띄운다(쓰지 않는 대화는 프로세스가 없다). 프로세스가 끝나면(죽거나 닫히면) 따라가는 쪽에 `error`, 반쯤 쓴 턴은 버린 `snapshot`을 보내고, 다음 `send`에서 같은 세션 id로 `resume`해 다시 띄운다.
- 서버가 `SIGINT`/`SIGTERM`을 받으면 모든 세션을 닫고 나간다.

## 8. 측정된 SDK 사실

claude-code-harness 스킬에서 (Claude Code 2.1.287–2.1.296):

- Stop hook은 도구를 안 쓴 턴에도 매 턴 끝에 온다 → 앱의 "작업 중" 상태로 게이트한다.
- `block`은 같은 턴을 이어 간다. 사람은 턴 하나를 본다.
- MCP 도구는 기본으로 스키마가 미뤄져 첫 사용 전에 `ToolSearch`가 한 번 돈다 → `alwaysLoad: true`. 화면에서 `ToolSearch` 호출은 접는다.
- 실패·거절·멈춤의 `tool_use_result`는 객체가 아니라 문자열이다. fold는 두 모양을 다 받는다.
- `allowedTools`에 있는 도구는 `canUseTool`을 거치지 않는다.
- `env`를 주면 환경이 통째로 바뀐다. `USER`가 없으면 로그인을 못 찾는다.
- 이어 갈 때 지난 메시지는 흐름으로 다시 오지 않는다. `getSessionMessages`로 읽는다.
- `includePartialMessages`의 `stream_event` 순서: `message_start` → 블록 시작 → 조각 → 그 블록의 `assistant` → … → `message_stop`.
- 환경에 `ANTHROPIC_API_KEY`가 있으면 묻지 않고 쓴다.
- MCP 도구 결과가 25,000토큰(`MAX_MCP_OUTPUT_TOKENS`) 또는 50,000자를 넘으면 Claude Code는 결과를 파일로 옮기고 경로만 준다(문서 `[mcp]`). 이 에이전트에는 파일을 여는 도구가 없으므로(내장 도구는 `WebSearch`뿐) 그 결과는 사라진 것과 같다 → 도구가 스스로 나눠서 돌려준다. 10,000토큰 넘으면 경고.

fitz에서 직접 잰 것 (Claude Code 2.1.302, SDK 0.3.302, 2026-10-18):

- **`settingSources: []`만으로는 격리되지 않는다.** claude.ai 로그인으로 돌면 사람이 claude.ai에 연결해 둔 커넥터(Gmail·Drive·Calendar·Notion…)가 **두 번째 요청부터** 붙었다(첫 요청 뒤에 연결이 끝난다). `getContextUsage()`: MCP tools 28,091토큰(fitz 도구 4개는 662). 사람의 스킬 19개가 목록에 실렸고 자동 메모리가 켜져 있었다. → `strictMcpConfig: true` + `settings.disableClaudeAiConnectors` + `skills: []` + `autoMemoryEnabled: false` + `disableBundledSkills`로 두 번째 요청이 31,871 → 2,610토큰(Haiku 측정). 남는 것: Claude Code에 들어 있는 플러그인 3개(`cc-plugin-*`)와 그 스킬 3개, `/` 명령 39개 — 모델에게 가는 도구는 fitz 4개뿐이다.
- **부모 Claude Code 세션의 환경이 따라온다.** 서버를 Claude Code 안(Octave의 터미널, Claude의 Bash)에서 띄우면 `process.env`에 `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`·`_TOKEN`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_EFFORT` 등이 있다. 그대로 넘기면 우리 에이전트가 남의 세션의 자식이 된다 → `ownEnv`.
- `allowedTools`에 이름을 넣은 도구가 있으면 **세션을 열 때마다** `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 경고가 난다. 의도한 것(읽기는 묻지 않는다)이므로 그대로 둔다. 읽기까지 `canUseTool`로 허락하면 경고는 없어지지만, 읽을 때마다 세션 상태가 `requires_action`으로 바뀌어 "답을 기다리는 중"이 깜빡인다.
- `tools: []`는 `ToolSearch`도 없앤다. 서버의 `alwaysLoad: true` 덕에 fitz 도구는 처음부터 실려 있어 문제없었다(init의 tools = fitz 4개).
- `result.total_cost_usd`는 프로세스의 누적값이다 → 턴의 비용은 직전 누적값과의 차.
- Opus 5.5 + `display: "summarized"`: 생각하는 동안은 `thinking_tokens`만 오고 요약 글은 거의 끝에 몰려 온다. 답의 글은 조각으로 흐른다.
- `for await`에서 `break`하면 query가 닫힌다. 턴 끝에 `getContextUsage()` 같은 걸 부르려면 루프 안에서 부른다.
- `deleteSession`은 세션 파일만 지우고 빈 프로젝트 폴더(`~/.claude/projects/<cwd>/`)를 남긴다.
- **`outputFormat`은 `tools: []`에서도 돈다**(Haiku, 2026-10-18): Claude Code가 `StructuredOutput` 도구를 스스로 더하고(init의 tools 맨 앞), Claude는 그 도구로 결과를 낸다. `canUseTool`을 거치지 않는다(모두 거절해도 통과). 결과는 `result.structured_output`(그리고 `result.result`에 같은 JSON 글). 세션 파일에는 `StructuredOutput` tool_use로 남아 다시 열어도 보인다. 같은 대화의 다음 메시지에도 다시 결과를 낸다(빈 목록도). → 대화 화면에서 `StructuredOutput` 줄은 숨긴다. 제안의 상태(열림·반영·무시)는 기록에 없으므로 DB에 둔다.
- Claude Code가 MCP 도구의 "항상 허용"으로 주는 제안은 `addRules` → `localSettings`(파일)다. 그대로 돌려주면 `~/.fitz/agent/.claude/settings.local.json`에 적혀 다음 대화에서도 묻지 않게 된다 → 앱이 `destination: "session"` 규칙을 직접 만든다.
- 쓰기를 거절하면(`deny` + 메시지) Claude는 다른 길로 시도하지 않고 그 사실과 대안을 말했다(Haiku, 실제 책 사본: "다른 방식으로도 시도하지 않았습니다").
- 묻는 동안 `session_state_changed`가 `requires_action`, 답하면 `running`(녹화 `translate.jsonl`).
- **멈춘 턴**(`interrupt()`): `result`가 `terminal_reason: "aborted_streaming"`, `is_error: true`로 온다. 오류가 아니라 사람이 멈춘 것이므로 화면은 `reason`으로 가른다. 세션은 살아 있고 다음 메시지에 정상으로 답했다(Haiku, 실제 책 사본).
- **닫기는 `close()`가 아니라 `return()`**(SDK 코드, 0.3.302): `close()`는 메시지 흐름을 바로 끝내고 기다리지 않는다. 프로세스는 입력이 끝난 뒤에도 세션 파일에 쓴다(대화 제목 `ai-title`) — 실제 테스트가 세션을 지운 뒤 그 줄이 파일을 되살렸다. `return()`은 같은 정리를 하되 프로세스가 끝날 때까지(최대 2초, 그 뒤 SIGTERM) 기다린다 → `session.close()`가 그것을 돌려주고, 서버 종료·테스트·녹화는 그걸 기다린 뒤에 지운다.
- 작업 대화의 init `tools`는 읽기 도구 넷과 `StructuredOutput`뿐(녹화 `review.jsonl`·`typos.jsonl`). 쓰기 도구는 서버에 없으니 Claude에게 보이지도 않는다.
- 읽기 도구를 `allowedTools`에 두면 SDK가 세션마다 `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 경고를 낸다("canUseTool이 읽기 도구에는 불리지 않는다"). 의도한 그대로다(읽기는 묻지 않는다, §1).
- **웹 검색**(`tools: ["WebSearch"]` + `allowedTools`에 `WebSearch`, Opus 5.5, 2026-10-19, 녹화 `websearch.jsonl`): init의 tools = `WebSearch` + fitz 8, 번역자에게 묻지 않고 돌았다(`requires_action` 없음). 검색 하나가 `tool_use` 하나다. 입력은 `query`와, d.ts(0.3.302)에 없는 `mode: "standard" | "extended"`. 모델이 읽는 결과는 `Web search results for query: "…"` 로 시작하는 글(링크 목록과 요약)이고, 흐름의 `tool_use_result`는 `{ query, results, durationSeconds, searchCount }`라 `structuredContent`가 없다 → fold는 그 글을 결과로 쥐고, 세션 파일에서 다시 읽어도 같다. "¶2의 국내 번역본들을 웹에서" 질문: `read` 1 + 검색 3, 63초, $0.159, 요청 4,180 → 9,520토큰(검색 결과만큼 자란다). Claude는 확인하지 못한 것을 확인하지 못했다고 말하고 출처 주소를 달았다. Haiku 실제 테스트: 검색 1회, 8.7초. 같은 코드로 오탈자 작업(Sonnet)의 tools는 여전히 읽기 넷 + `StructuredOutput`.
- 검색이 도는 중에 사람이 메시지를 보내면 그 호출은 결과 자리에 `{ detachedToolCall: true }`를 싣고 비켜나며 진짜 결과는 다음 턴에 온다(SDK d.ts). fitz의 입력칸은 턴 중에 막혀 있어 이 길은 열리지 않는다.

- **Stop hook, fitz의 세션 설정 그대로**(2026-10-19, SDK 0.3.302 / Claude Code 2.1.302, Haiku; 스크립트 `.context/measure/stop-hook.mjs`):
  - `{ decision: "block", reason }` → **같은 턴이 이어진다.** Claude가 이유를 읽고 `set_translation`을 다시 불러 고쳤고, `result`는 하나(5턴, 13.6초, $0.002). 두 번째 호출에서 `stop_hook_active: true`.
  - 돌려보낸 이유는 스트림에 **`isSynthetic` 사용자 메시지** `"Stop hook feedback:\n<reason>"`으로 온다(`isReplay` 아님 → 지금의 fold는 무시한다). 세션 파일 원본에는 남지만(`isMeta` 사용자 메시지, `hook_blocking_error` 첨부, `stop_hook_summary` 시스템 항목 — 2026-10-19 실전에서 확인) **`getSessionMessages`는 하나도 돌려주지 않는다** → fitz가 다시 열면 사라지므로, 돌려보냈다는 사실과 이유는 **앱이 턴 기록에 남겨야** 한다. 모델에게는 `<system-reminder>` 안의 `Stop:Callback hook blocking error from command: "callback": <reason>`으로 보인다.
  - 도구를 안 쓴 턴에도 hook이 한 번 불린다 → 검사할 것(그 턴에 Claude가 쓴 단락)이 없으면 그냥 통과.
  - hook이 던지면 턴은 그냥 끝난다(`success`/`completed`, 스트림에 오류 없음): **fail-open**. 통과도 흔적이 없다.
  - hook 도중 `interrupt()` → hook의 `signal`이 abort되고 턴은 `success`/`completed`로 끝난다(`aborted_streaming`이 아님) → 멈춘 턴은 앱이 알고(`stop`을 받았으므로) 검사 결과를 남기지 않는다.
  - `includeHookEvents: true`여도 SDK 콜백 hook에는 `hook_started`·`hook_response`가 오지 않았다.
  - `last_assistant_message`(마지막 답의 글)와 `background_tasks`(빈 배열)가 입력에 온다.

- **대화 도중 모델·강도 바꾸기**(2026-10-19, SDK 0.3.302, fitz의 세션 설정 그대로; 스크립트 `.context/measure/set-model.mjs`, `flag-merge.mjs`). 누가 답했는지는 assistant 메시지의 `model`, 강도는 Stop hook 입력의 `effort.level`로 읽었다:
  - 턴 사이 `setModel("claude-sonnet-5-5")` → 다음 턴은 Sonnet이 답한다. `system/init`이 턴마다 다시 오며 그때의 모델을 싣는다.
  - `applyFlagSettings({ effortLevel: "high" })`은 시작할 때 준 `effort: "low"`보다 앞선다(Stop에서 `high`). 그 뒤 `setModel`로 모델만 바꿔도 강도는 남는다.
  - 같은 층에 시작할 때 준 `settings`(커넥터 끔·자동 메모리 끔·번들 스킬 끔)는 강도를 바꾼 뒤에도 그대로다(`get_settings`로 확인, 턴 없이).
  - 프로세스를 닫고 다른 `model`·`effort`로 `resume`하면 그 값으로 답한다.
  - `supportedModels()`: Opus 5.5·Sonnet 5.5·Haiku 5.5 모두 강도 low~max.
  - `total_cost_usd`는 프로세스의 누계이고, `resume`한 프로세스는 세션 파일에 남은 누계에서 이어 센다(5번째 턴 $0.0476 = 앞 넷 $0.0446 + $0.003). fold는 턴 비용을 누계의 차이로 구하는데, 서버를 다시 켜면 `spent`가 0에서 시작하므로 **재시작 뒤 첫 턴의 비용이 그 대화의 누계로 보인다** — §18 6행.

## 9. 지금 하지 않는 것

| 것 | 이유 |
|---|---|
| Electron/Tauri 셸, worktree, PR, GitHub | 해당 없음. 나중의 Tauri 전환은 `server/`를 사이드카로 옮기면 된다 |
| 서브에이전트(`agents`), Workflow | 장 하나가 한 대화에 들어간다(825 세그먼트/26장). 커지면 단락 묶음 분배 |
| 바이너리 fetch·sha512·codesign | SDK 동봉분으로 충분. 배포 시 재검토 |
| 번역 스레드 영속화 | 댓글로 저장할 수 있다. 필요가 드러나면 |
| `WebFetch`(페이지 열기) | 작은 모델이 요약한 페이지 글이 대화에 들어온다 — 웹페이지 속 지시문이 들어올 길이 하나 더 생긴다. 인물·지명 확인은 검색 결과로 된다. 필요가 드러나면 |
| 자동 reviewed/final | 절대 |

## 10. 빌드 순서 (행 = 커밋)

| # | 조각 | 사람이 보는 것 | 검증 | 결과 |
|---|---|---|---|---|
| 1 | 이 문서 + 의존성 | — | `pnpm test` 48 통과, SDK import, 바이너리 2.1.302 | 2026-10-18 완료 |
| 2 | `agent/tools.mjs` 읽기 도구 4 + 테스트 | — | 금지 필드 부재, 기존 함수와 같은 값 | 2026-10-18. 서버 테스트 62 통과. 실제 책: 26장 825단락을 `next`를 따라 39호출에 빠짐·중복 없이 읽음, 결과 최대 29,307자, 금지 필드 0 |
| 3 | `agent/session.mjs` + `fold.mjs` + 녹화 fixture 1개 | — | 첫 실전: "이 단락 뉘앙스 설명" 1회, 녹화 → `agent/fixtures/` | 2026-10-18. 서버 테스트 72. Gatsby ¶4 질문(Opus 5.5/medium): `read(ids:[4], around:3)` 1회 → 생각 → 답, 21초, $0.039, 요청 2,265·3,312토큰. 실제 책 ¶36: `read` + `glossary`, 34초, $0.080(격리 전 52초, $0.327). Claude가 앞뒤 단락·사람의 댓글·이미 번역된 단락의 문체를 근거로 답함 |
| 4 | WS 라우트 + `protocol.mjs` + 서버의 대화 관리(start·send·stop·open) + 터미널 대화 스크립트 `agent/chat.mjs` | 터미널에서 질문하고 답이 흐름 | 스텁 세션으로 프로토콜 테스트, 실제 1회 | 2026-10-18. 서버 테스트 84. 스텁 세션(녹화 메시지를 흘려 넣음)으로: 중간에 붙은 두 번째 페이지도 서버와 같은 상태, 다른 사이트 Origin은 401, 프로세스가 죽으면 다음 메시지에서 같은 세션 id로 resume. 실제: 서버(책 사본)에 `chat.mjs`로 ¶36 질문(Haiku) → `read(ids:[36], around:2)` → 답, 4.2초, $0.001. 6초에 멈춤 → `aborted_streaming`, 같은 대화의 다음 질문에 정상 답. 확인이 만든 세션 2개는 `deleteSession`으로 지움 |
| 5 | 쓰기 도구 4 + 승인 흐름(`canUseTool` → `ask` → `answer`) | 터미널에서 승인/거절, ⌘Z로 되돌림 | 스텁 세션 + 실제 1회 | 2026-10-18. 서버 테스트 102. 실제 책 사본(Haiku): "¶36을 번역해 넣어줘" → `read`·`glossary` → `set_translation` 미리보기 → 허락 → ¶36 draft, ops에 `updateSegment` 1행, `/api/undo`로 untranslated로 복귀. "Zemurray를 제머리로 등록" → 거절 → 등록 없음, Claude는 다른 길을 찾지 않고 현재 표기(샘 저머레이)와의 차이를 알림. 실제 책 쪽 두 턴: 9.7초 $0.002, 2.7초 $0.0004. Gatsby 녹화 `translate.jsonl`(Opus 5.5, 허락): `read` → `book` → `set_translation`, 13.7초, $0.062 |
| 5.5 | 쓰는 쪽이 둘인 책(§12): 버전 + 확인 / 변경 알림(처음엔 SSE, §15에서 `/live`로) / 에디터가 듣고 충돌에서 글을 지킴 | Claude가 쓰면 에디터에 바로 보이고, 겹치면 덮지 않고 알림 | 서버 테스트 + e2e | 2026-10-18. 커밋 셋. 서버 테스트 114, pytest 31, 화면 단위 34, e2e 30(새 3: 다른 쪽의 쓰기가 새로고침 없이 보임 / ⌘Enter 충돌 → 덮지 않음, "changed since" 임시본, Recover 후 저장 / Tab 충돌도 같음) |
| 6 | `checks.mjs` + Stop hook + `agent_turn` | 검증 결과와 되돌림 횟수 | 순수 테스트 + 스텁 세션 | 2026-10-19 완료(§19, 커밋 여덟). 서버 테스트 204, 화면 단위 63, e2e 50, pytest 35. 실측 §19: Haiku 턴당 8~31초, $0.001~0.002 |
| 7 | 리뷰·오탈자(`outputFormat`) | 정해진 모양의 목록 | 녹화 1회 | 2026-10-18 완료(§4.2, 커밋 일곱). 서버 테스트 178(+실제 2), 화면 단위 47, e2e 37. 실측: 오탈자 6.0초 $0.022 심은 오류 넷 다, 리뷰 7.3초 $0.025 뜻이 뒤집힌 번역 high |
| 8 | resume·재시작 복구 | 서버를 껐다 켜도 이어짐 | 테스트 | 2026-10-18 완료(§13: 대화 목록·턴 기록은 book.db, 세션 파일 사본은 `~/.fitz/sessions`) |
| 9 | 페이지 Agent 탭(스레드·스트리밍·Stop·비용·승인 카드·결과 카드), 에이전트가 쓴 것을 에디터가 다시 읽기, README | 에디터 안에서 전부 | e2e(녹화 프레임) | 2026-10-18 완료(§17, 패널의 **Claude** 탭). 화면 단위 62, e2e 44. 실제 1회(아래 §17.1 5행) |
| 10 | 웹 검색: `tools: ["WebSearch"]`(대화만), 지시문 한 문단, Claude 탭의 줄 | Claude 탭에 "Searched the web for “…”" 줄, 답에 출처 주소 | 녹화 `websearch.jsonl`, 실제 테스트, e2e(녹화 프레임) | 2026-10-19. 서버 테스트 190(+실제 3), 화면 단위 62, e2e `claude.spec` 9. 실측은 §8 |

9단계에서 꼭 할 것: 지금 에디터 화면은 에이전트가 DB에 쓴 것을 모른다. 열어 둔 채 Claude가 쓰면 화면은 옛 글을 보이고, 그 단락을 편집해 저장하면 Claude가 쓴 것을 덮는다(에이전트 쪽은 `expectUpdatedAt`으로 막지만 화면 쪽은 막는 것이 없다). 서버가 쓰기마다 "바뀐 단락"을 소켓으로 알리고 화면이 그 단락을 다시 읽는다.

순서의 이유: 4~8은 백엔드다. 화면은 백엔드가 주는 데이터(대화, 승인 요청, 검증 결과, 리뷰 목록)가 정해진 뒤에 그리는 편이 쉽고, 그동안은 `chat.mjs`로 터미널에서 직접 써 본다. 쓰면서 화면에 무엇이 필요한지가 드러난다.

## 11. 테스트

네 층, 전부 유지:
1. **순수 함수**(`node --test`) — `tools`·`fold`·`foldStored`·`records`·`keep`을 스크래치 DB와 **녹화된** 실제 세션(`agent/fixtures/*.jsonl`, `*.stored.json`)으로. 손으로 쓴 프레임은 녹화에 없는 경우(도구 오류, 누적 비용)에만.
2. **서버의 대화와 연결** — host와 `/live`를 가짜 세션(`fixtures/stubSession.mjs`, 녹화를 흘려 넣음)으로. 사본 기능에도 가짜를 넣어 홈 폴더를 건드리지 않는다.
3. **실제 화면**(Playwright, 헤드리스) — 서버는 책 DB 사본(`/tmp/fitz-e2e.db`)으로 뜬다. 다른 쪽의 쓰기는 테스트가 서버 API를 직접 불러 흉내 낸다. 에이전트만 쓸 수 있는 것(Claude의 댓글)은 사본 DB에 직접 넣고 지운다 — 서버에 "agent" HTTP 문을 만들지 않는다. 연결이 끊기는 장면은 `page.routeWebSocket`으로 `/live`를 가로채 끊는다.
4. **진짜 Claude**(Haiku) — `pnpm test:real`(= `FITZ_REAL_CLAUDE=1`)일 때만. 평소 `pnpm test`는 건너뛴다. host와 fitz 도구를 실제 서버와 같은 길로 지나고, 메모리의 Gatsby 책, 새 임시 폴더에서 돌며, 끝나면 세션을 `deleteSession`으로 지우고 빈 프로젝트 폴더까지 치운다. 지금 확인하는 것: Claude의 쓰기가 `actor = agent`와 **그 도구 호출의 id**로 기록되는가(2026-10-18 통과, 3.7초).

녹화(`agent/record.mjs`)와 수동 확인도 같은 원칙: 책은 사본이나 Gatsby, 세션은 임시 폴더, 끝나면 지운다. 확인하기 전과 후에 `~/.claude/projects`와 `~/.fitz`를 본다.

"테스트가 지키는 것"은 고장을 넣어 확인한다: 재연결 e2e는 다시 붙은 뒤의 resync를 끄면 놓친 변경에서 실패했다.

## 12. 쓰는 쪽이 둘인 책 (5.5단계)

5단계로 책에 쓰는 쪽이 둘(번역자의 에디터, 에이전트)이 됐다. 막아야 할 것: 한쪽이 쓴 것을 다른 쪽이 모른 채 덮는 것. 편집 칸(ProseMirror)이 아니라 저장 쪽의 문제이므로, 저장 쪽의 표준으로 푼다.

| 조각 | 무엇 | 왜 이렇게 |
|---|---|---|
| 버전 | `segment.version`. 내용 칸(원문·번역·상태·종류·확인)이 바뀔 때마다 DB 트리거가 **책 전체에서 가장 큰 번호 + 1**을 준다 | 낙관적 동시성(HTTP ETag/If-Match, ProseMirror collab의 버전과 같은 원리). 트리거라서 어느 쓰기 경로도(⌘Z 포함, 앞으로 생길 것도) 빠지지 않는다. 책 전체 번호라 지웠다 되살린 단락도 예전 번호로 돌아가지 않는다(ABA 없음). `updated_at`(초 단위)은 같은 초의 두 쓰기를 못 가른다. 재번호(idx)는 내용 변경이 아니므로 올리지 않는다 |
| 확인 | `updateSegment { expectVersion }`: 다르면 409, 아무것도 쓰지 않는다. 같은 트랜잭션 안에서 비교 | 검사가 한 곳. 에디터의 저장과 에이전트의 `set_translation`이 같은 검사를 지난다. `expectVersion`은 기록되는 명령에 들지 않는다(redo가 그 번호에 묶이지 않게) |
| 알림 | (처음엔 SSE `GET /api/events`, 지금은 실시간 연결 `/live`의 `changed` — §15.) `execute`/`undo`/`redo`가 커밋한 뒤 `{ opId, name, segmentIds, kind: do·undo·redo }`를 알린다(`watchChanges`). 이 컴퓨터의 페이지만, 30초마다 살아 있음 신호 | 모든 쓰기가 그 셋을 지나므로 알림도 한 곳에서. 한 방향이고 브라우저가 다시 붙어 주는 표준이 SSE다. 에이전트 통로(WebSocket)와 나눈다: 에디터는 에이전트를 쓰지 않을 때도 책의 변화를 알아야 한다. SSE id는 쓰지 않는다(다시 붙으면 다시 읽으므로 되풀이할 것이 없고, undo는 원래 op와 같은 id다). 알림 받는 쪽의 오류는 쓰기를 되돌리지 않는다 |
| 에디터 | `api.watchChanges`(EventSource) → 150ms 모아서 화면의 것(장·단락·주석·용어집)을 다시 읽는다. 다시 붙으면 `resync`. 편집 칸은 **편집을 시작할 때의** 버전·글을 기억해 저장에 그 버전을 보내고, "안 바뀜"도 그 글과 비교한다. 칸 밖의 글 변경(맞춤법 수락 등)은 화면의 버전, 표시 토글(확인·종류)은 보내지 않는다 | 화면이 새로 읽으면 화면의 버전도 새것이 되므로, 그것을 보내면 편집 칸의 옛 글이 남의 새 글을 덮는다. 표시 토글은 서버가 다른 칸을 저장된 값으로 합치므로 글을 덮을 수 없고, 빠른 토글의 가짜 충돌을 피한다. 맞춤법 코퍼스는 다시 읽지 않는다(원문은 에이전트가 쓰지 않고, 이 페이지의 원문 편집은 스스로 갱신) |
| 충돌 | 409면 저장하지 않고 "그사이 바뀜"을 알린 뒤 그 단락을 다시 읽는다. **저장이 성공하기 전에는 쓰던 글을 지우지 않는다**: 실패하면 그 자리에서 임시본으로 남기고(⌘Enter·Tab·blur·분할 전 저장 모두), 바탕 글이 바뀐 임시본은 지우지 않고 "the paragraph changed since"와 함께 Recover/Discard를 보인다. Recover해 저장하면 그때의 버전으로 — 번역자가 고른 덮어쓰기다. 분할 전 저장이 거절되면 분할하지 않는다 | 전에는 바탕 글이 바뀐 임시본을 조용히 지웠고(`PairRow`·`SegmentRow`), ⌘Enter는 저장 전에 임시본을 지웠고, 임시본은 타이핑이 멈출 때만 적혔다 — 충돌에서 번역자의 글이 사라지는 길 셋 |

ProseMirror의 공동 편집(`prosemirror-collab`)은 같은 버전 원리에 "남의 변경 위에 내 수정을 다시 얹기"를 더한다. 그것은 여러 사람이 한 문서의 다른 곳을 조금씩 고칠 때의 것이고, 에이전트는 단락 번역을 통째로 새로 쓰므로 합치지 않고 번역자가 고른다. Yjs(Tiptap Collaboration)는 실시간 동시 타이핑용이며 저장 구조(SQLite·ops·⌘Z)를 바꿔야 해서 쓰지 않는다.

실제 서버로 확인(책 사본): 본 버전으로 저장 → 성공, 같은 옛 버전으로 다시 → 409, 알림 통로에 저장과 ⌘Z가 한 번씩. 버전 없는 DB로 띄우면 마이그레이션 명령을 말하고 종료(코드 1).

기존 DB는 `uv run python -m pipeline.migrate out/book.db`로 올린다. 버전 칸이 없는 DB는 서버가 열지 않는다(조용히 덮어쓰게 두지 않는다). 2026-10-18 작업 DB를 올림: 백업 `out/book.db.bak-2026-10-18-before-versions`, 825단락, 무결성 정상.

## 13. 대화 저장과 이어가기 — Octave와 같은 모양 (8단계 설계, 2026-10-18)

지금은 대화가 서버 메모리에만 있다. 대화의 **내용**은 잃지 않는다(Claude Code가 디스크에 쓴다). 빠진 것은 목록, 다시 열어 그리기, 이어 가기다.

### 13.1 Octave가 하는 것 (설치된 0.0.20과 `~/.octave`를 읽어 확인)

| 무엇 | Octave의 기록 | 쓰는 SDK |
|---|---|---|
| 대화 목록 | `claude-conversations.json`: 폴더 → `[{ id, sessionId, createdAt, usedAt, title? }]`. 대화 id는 앱의 것, `sessionId`는 첫 메시지 전에는 `null` | 자기 목록을 둔다 — `listSessions`는 쓰지 않는다 |
| 턴 | `claude-turns.json`: 세션 id → 사람 메시지 uuid → `{ reason, origin, ms, cost }` | 세션 파일에 `result`가 없어서 |
| 대화별 모델 | `claude-choices.json`: 세션 id → `{ model }` | |
| 다시 열기 | `getSessionMessages` + 자기 턴 → `claudeItemsFromStored(messages, turns)` | `getSessionMessages` |
| 이어 가기·되감기·가르기 | `resume`, `resumeSessionAt`, `forkSession` | 그대로 |
| 30일 청소 대비 | 없음(배포된 코드에 세션 파일 사본·`cleanupPeriodDays`·`sessionStore`가 없다) | — |

대화 id와 세션 id를 나누는 이유: 대화는 첫 메시지 전에도 있고, 되감기·가르기는 **새 세션 id**를 만든다 — 대화는 그대로인데 세션이 바뀐다.

### 13.2 fitz: 같은 모양, 저장은 SQLite

fitz에는 책 DB가 있고 대화는 그 책에 대한 것이므로 같은 기록을 `book.db`의 표 둘에 둔다(JSON 파일 대신: 한 트랜잭션, 이미 있는 마이그레이션).

```
agent_conversation(id TEXT PRIMARY KEY, session_id TEXT, title TEXT, model TEXT, effort TEXT, created_at, used_at)
agent_turn(session_id TEXT, user_uuid TEXT, reason TEXT, origin TEXT, ms INTEGER, cost REAL, PRIMARY KEY (session_id, user_uuid))
```

- `start`: 행 하나(session_id NULL). 첫 `send`의 `init`에서 session_id를 채운다.
- `result`마다: `agent_turn` 한 행.
- 서버가 켜질 때·페이지가 물을 때: 목록은 `agent_conversation`에서(제목이 비면 `getSessionInfo`의 자동 제목).
- `open`: 메모리에 없으면 `getSessionMessages` + `agent_turn` → `foldStored`(fold.mjs와 같은 items 모양을 만드는 순수 함수)로 snapshot. 프로세스는 다음 `send`에서 `resume`.
- 테스트: `foldStored(녹화의 *.stored.json, 턴) ≈ fold(녹화의 흐름)`(공통 부분), 서버 재시작(스텁), 실제 1회.

**Octave보다 하나 더: 세션 파일 사본.** 번역은 몇 달 가는 일이라 Claude Code의 30일 청소에 대화를 잃을 수 있다. 턴이 끝날 때 `<세션 id>.jsonl`을 `~/.fitz/sessions/`로 통째 복사하고, `resume` 전에 원본이 없으면 되돌려 놓는다(`[sessions]`의 "Move the session file", 하네스에서 되살린 파일로 resume되는 것을 측정). 파일을 해석하지 않고 복사만 한다. SDK의 `sessionStore`는 임시 `CLAUDE_CONFIG_DIR`로 resume해 Keychain의 Max 로그인을 찾는지 미측정이라 지금은 쓰지 않는다.

**2026-10-18 완료**(커밋 다섯: 표 둘 / 서버가 대화·턴 기록 / 목록과 다시 열기(`foldStored`) / 세션 파일 사본 / 터미널 `--list`·`--open`). 작업 DB 백업 `out/book.db.bak-2026-10-18-before-conversations` 후 마이그레이션. 서버 테스트 134: 녹화 둘 모두 "디스크에서 다시 읽은 대화 = 살아서 본 대화"(질문·도구 호출과 결과·생각·답·턴), 재시작 뒤 같은 세션으로 resume, 사본 저장·복원. 테스트와 녹화는 사본 기능에 가짜를 넣어 홈 폴더를 건드리지 않는다.
실제로 확인(책 사본, Haiku): 질문 → `--list`에 Claude Code가 지은 제목("¶36 'send for' 뜻") → 서버 재시작 → `--open`으로 지난 내용이 그려지고 "처음에 뭘 물었지?"에 첫 질문을 답함 → Claude Code의 원본 파일을 치운 뒤(30일 청소 흉내) 재시작·`--open` → 서버가 사본을 되돌려 놓고("restored the kept copy") "몇 번 물었지?"에 3. 확인이 만든 세션·사본은 지웠다.
측정된 사실: `result.user_message_uuid`가 그 턴을 시작한 메시지의 uuid이고 세션 파일의 그 메시지 uuid와 같다(턴 기록의 열쇠). `getSessionMessages`의 도구 결과에는 구조화된 결과가 없고 모델이 읽은 글만 있다 — fitz 도구는 JSON으로 답하므로 다시 객체로 읽는다. 파이프 입력의 터미널 대화는 입력이 답보다 먼저 끝나므로 닫힌 입력에 프롬프트를 띄우지 않는다.

## 14. 되돌리기 — 쓰는 쪽이 둘일 때 (설계)

**2026-10-19 만듦**(§18): ⌘Z·⌘⇧Z는 번역자의 것만, Claude의 것은 대화의 턴 끝 **Undo from here**로. 판정은 단락 버전이 아니라 "무엇을 건드렸나"(§18). 아래는 설계 당시의 글이다.

그때 ⌘Z는 `ops`의 마지막 행을 되돌렸다: Claude가 방금 쓴 것을 번역자의 ⌘Z가 되돌릴 수 있었다.

**Claude Code가 하는 것**(`[checkpointing]`): 편집기의 ⌘Z와 따로, Claude의 파일 편집만 **보낸 메시지(턴)마다 한 줄로** 체크포인트를 쌓는다(세션당 최근 100개). `/rewind`는 고른 메시지 **직전 시점으로** 되돌린다 — 그 뒤 턴들의 Claude 편집이 한꺼번에 돌아간다(diff 하나를 골라 빼는 방식이 아니다). Bash로 바꾼 것, 사람이 손으로 고친 것은 추적하지 않는다. 사람의 타이핑 되돌리기는 편집기 몫이다. 공동 편집기(구글 독스, Yjs `trackedOrigins`, ProseMirror의 `addToHistory: false`)도 ⌘Z는 "내 것만"이다.

**fitz에 옮기면**: 기록(`ops`)은 지금처럼 한 줄 하나. 거기에 누가 했는지(§16)를 단다.
- 번역자의 ⌘Z: 번역자의 op 중 마지막 것을 되돌린다.
- Claude의 것: 대화에서 턴(또는 도구 호출)을 골라 "여기 직전으로" — 그 뒤 Claude의 op들을 최근 것부터 되돌린다(Claude Code의 rewind와 같은 선형).
- 둘 다, 되돌릴 op 뒤에 **다른 쪽이** 같은 단락을 고쳤으면 되돌리지 않고 말한다(op마다 적용 직후의 단락 버전을 적어 두고 §12의 버전과 비교).
- 화면에서 어떻게 고르고 보여 줄지가 함께 정해져야 하므로 9단계(화면)와 같이 만든다. 기록(§16)은 그 전에 시작해 둔다 — 지금부터의 변경에 "누가"가 남도록.

## 15. 화면 연결을 하나로 — Octave처럼 (계획)

**지금 셋이다**: 책 동작은 HTTP POST(`/api/*`), 책 변경 알림은 SSE(`GET /api/events`), 에이전트는 WebSocket(`/agent`). 에디터는 SSE만, 터미널 대화는 WebSocket만 쓴다.

**Octave**: 페이지당 WebSocket 하나(`/`)에 대화와 앱 상태(`claude_message`, `claude_asked`, 목록, 모델…)를 모두 싣고, 터미널만 따로(`/pty`). 하네스 §1도 같다.

**목표**: 요청→응답인 책 동작은 HTTP POST 그대로(결과·오류가 응답으로 돌아오는 게 가장 단순하다), **움직이는 것은 전부 WebSocket 하나(`/live`)로** — 대화의 흐름과 책 변경 알림. 한 연결 안에서는 순서가 지켜지므로 "snapshot 다음에 그 뒤 메시지"가 보장된다.

| # | 할 일 | 파일 |
|---|---|---|
| 1 | 소켓을 페이지의 실시간 연결로: 경로 `/live`, 연결마다 `watchChanges(db)`를 걸어 `changed { opId, name, segmentIds, kind }`를 보내고 닫히면 뗀다. 30초 ping으로 죽은 연결을 끊는다. 프로토콜에 `changed` | `server/live.mjs`(지금의 `agent/socket.mjs`를 옮김), `agent/protocol.mjs` |
| 2 | 페이지의 연결 하나: 열고, 끊기면 0.5→5초로 다시 붙고, 다시 붙으면 `resync`(화면 다시 읽기) + 따라가던 대화를 다시 `open`, 열리기 전에 보낸 것은 줄 세웠다 보냄. `api.watchChanges`가 이 위에 선다(9단계의 대화 화면도 같은 연결) | `app/src/data/live.ts`, `http.ts` |
| 3 | SSE를 걷는다: `/api/events` 경로와 `events.mjs`. `watchChanges`는 `commands.mjs`에 그대로 | `server/index.mjs`, `events.mjs` 삭제 |

**2026-10-18 완료**(커밋 셋: 서버 `/live` + `changed` + 30초 생존 확인 / 화면의 `lib/live.ts`(다시 붙기 0.5·1·2·5초, 다시 붙으면 `resync`) / SSE 삭제). 보내기와 대기열은 대화 화면(9단계)에서 더한다. 서버 테스트 118, 화면 단위 38, e2e 30(두 번 연속). e2e의 Recover 뒤 ⌘Enter는 편집 칸이 포커스를 받은 뒤 누르도록 고쳤다(알림이 빨라져 드러난 테스트의 경쟁).
| 4 | 터미널 대화를 `/live`로 | `agent/chat.mjs` |
| 5 | 테스트: 서버 — 두 페이지 모두 `changed`를 받음, 다른 사이트 거절, 닫힌 연결은 듣기를 멈춤(지금의 events 테스트를 옮김). 페이지 — 연결의 다시 붙기·줄 세우기(단위 테스트, Node의 WebSocket). e2e — `writers.spec` 셋이 그대로 통과 | `server/live.test.mjs`, `app/src/data/live.test.ts` |

Agent SDK와의 관계: SDK는 연결 방식을 정하지 않는다. 바뀌는 것은 운반뿐이고, 대화는 같은 SDK 메시지를 같은 fold로 접는다.

## 16. 누가 바꿨는지 기록 — 번역자와 Claude 둘일 때 (계획)

사용자는 번역자 한 사람과 Claude다. 계정·로그인 체계는 필요 없다. **누가 썼는지는 들어온 문으로 이미 정해진다**: 번역자의 쓰기는 HTTP 경로(`/api/*`)로만, Claude의 쓰기는 fitz MCP 도구 함수로만 들어온다. 그 자리에서 이름표를 붙인다.

- `ops`에 `actor`(`translator` | `agent`)와 `tool_use_id`(Claude의 쓰기일 때). `execute(db, name, params, by)` — HTTP 경로는 `{ actor: "translator" }`, 도구 함수는 `{ actor: "agent", toolUseId }`.
- `toolUseId`는 SDK가 준다(측정, Claude Code 2.1.302): 도구 함수의 두 번째 인자 `extra._meta["claudecode/toolUseId"]` = 흐름의 `tool_use.id` = `canUseTool`의 `toolUseID`. 그래서 DB의 변경 하나가 대화의 그 줄과 이어진다(어느 대화인지는 그 id가 든 세션). 앱이 따로 번호를 만들 필요가 없다.
- 지금까지의 행은 `translator`(에이전트는 막 생겼고, 그 쓰기는 확인용 사본 DB에만 있었다).
- 댓글: `comment.author`(`translator` | `agent`). 본문의 `Claude: ` 머리말은 없앴고, 화면의 댓글 목록이 Claude의 것에 "Claude"를 붙인다. 역주에는 따로 칸을 두지 않는다(출판될 글이고, 출처는 `ops`로 안다).
- 테스트: 경로의 쓰기는 translator, 도구의 쓰기는 agent + 그 tool_use_id, undo/redo는 원래 op의 actor를 유지, 지웠다 되살린 댓글도 작성자 유지.
- **2026-10-18 완료**(커밋 셋: 스키마 / 모든 변경에 actor / 댓글 author). 작업 DB 백업 `out/book.db.bak-2026-10-18-before-actor` 후 마이그레이션, 기존 22개 op·댓글은 translator. 서버 테스트 118, e2e notes 5.

## 17. Claude 탭 — 에디터 안의 대화 (9단계, 2026-10-18)

> 2026-10-19부터 오른쪽 패널은 탭 없이 Claude 전용이다(§22): 머리줄의 ✦로 여닫는다. 아래의 "탭"은 지금의 이 패널이다.

갤러리 `?gallery&agent`(B안, 승인). 새 열은 없다: 본문에서 부르고(선택 툴바의 **Ask Claude**, ⌘L), 오른쪽 패널의 **Claude** 탭에서 대화하고, 바뀐 것은 본문으로 돌아온다(`/live`의 `changed`). 부품은 shadcn AI Elements 그대로: Message·Bubble(번역자), Trace(Claude가 읽고 생각한 것), Item(쓰기 허락, Confirmation 패턴), Input Group(입력·모델), Message Scroller(스크롤). 답의 글은 Streamdown(AI Elements가 쓰는 마크다운 렌더러: 쓰는 도중의 마크다운을 다루고, 모델의 글을 정화한다).

| 정한 것 | 왜 |
|---|---|
| 화면은 서버의 `fold.mjs`를 그대로 쓴다(상대 경로로 가져오고 타입은 옆의 `fold.d.mts`, Vite 개발 서버는 그 파일만 허용) | 대화가 무엇인지는 한 곳에서. 중간에 연 창도 서버와 같은 상태(하네스 원칙) |
| Suggestions는 Claude 탭 머리의 한 줄로 접힌다. 머리 = 대화 메뉴(지난 대화, New conversation) + Suggestions | 탭 수를 늘리지 않는다. Claude가 한 일은 한 곳에 |
| 탭은 빈 새 대화로 열린다. 지난 대화는 메뉴에서. 목록에는 자유 대화만(작업 대화는 제안으로 보인다) | Claude.ai와 같다. 예측 가능 |
| 모델·강도는 새 대화의 첫 메시지 전에 고른다. 그 뒤에는 보이기만 | 대화 하나 = 세션 하나 = 모델 하나(지금의 host). 도중 변경(SDK `setModel`)은 나중 |
| 쓰기 허락은 대화 안의 Item(전/후 비교, Deny·Always·Allow). 답하면 Trace 한 줄로 | AI Elements Confirmation 그대로. 본문의 변경은 ⌘Z로 되돌아간다(§14의 나누기는 다음) |
| 패널 폭은 끌어서 정하고 기억된다(`useDefaultLayout`) | 오른쪽은 shadcn Resizable로 둔다: shadcn Sidebar는 끌어서 넓힐 수 없다 |

### 17.1 만드는 순서 (행 = 커밋)

| # | 무엇 | 파일 | 확인 |
|---|---|---|---|
| 1 ✓ | 화면이 서버와 같은 fold를 쓴다 | `server/agent/fold.d.mts`, `app/vite.config.ts`, `app/tsconfig*.json`, `app/src/lib/fold.test.ts` | 녹화 넷을 화면 쪽에서 접어 서버와 같은지 |
| 2 ✓ | 대화 데이터: `/live`로 start·open·send·stop·answer·list, 스냅숏 + 메시지 fold + 허락 대기, 다시 붙으면 다시 따라감 | `api.ts`, `http.ts`, `lib/conversation.ts`(+test), `data/useConversation.ts` | 단위 |
| 3 ✓ | Claude 탭 화면(Suggestions를 머리로), Streamdown(+ CJK 플러그인: `**"인용"**과`처럼 한국어에 붙은 강조가 그대로 `**`로 남지 않게) | `features/agent/*`, `ReviewPanel.tsx`, `App.tsx` | e2e: 녹화 프레임을 `/live`로 흘려 대화·허락·Stop |
| 4 ✓ | Ask Claude: 선택 툴바 + ⌘L, 구절이 입력에 붙고 보낼 때 단락 id와 함께 | `FloatingToolbar.tsx`, `lib/keymap.ts`, `features/agent/*` | e2e |
| 5 ✓ | 진짜로 한 번(에디터에서), README·이 문서 | | 실측 |

**5행 실측**(2026-10-18, 에디터 화면 → 서버(포트 4802, Gatsby 사본) → 진짜 Claude Code, Haiku 5.5 / low; 스크립트는 `.context/real/`, 커밋하지 않음): ¶4의 "reserve all judgments"를 골라 Ask Claude → "앞 문장의 reserved와 말장난인지" → `read(¶4, 2 around)` → 생각 → 답, 8.4초 $0.0015. 이어서 "¶3을 번역해 넣어줘" → 허락 카드(전/후) → Allow → ¶3 번역이 에디터에 바로, 5.1초 $0.0006. 제목은 Claude Code가 붙임('Reserve all judgments'와 'reserved' 말장난). 실행이 만든 세션 하나는 `deleteSession`으로 지우고 사본도 지움(번역자의 세션 둘은 그대로).

이 실행에서 찾아 고친 것: 턴 끝 줄("5s · $0.001")이 답 옆에 끼어 있었다 — `Message`는 자식을 가로로 놓으므로 `MessageFooter`는 `MessageContent` 안에 둔다(e2e가 위치를 확인).

**턴 끝 줄은 걸린 시간만**(2026-10-19, 번역자의 결정): 비용은 보이지 않는다 — 번역자의 구독에서는 청구가 아니라 Claude Code의 추정치다. 기록(`agent_turn.cost`)에는 남고, 터미널 `chat.mjs`는 그대로 찍는다.

## 18. 다음 작업 (2026-10-19)

어제까지: Claude 탭(§17), 리뷰·OCR 제안(§4), 패널 폭 기억. 테스트 서버 178(+실제 2), 화면 단위 62, e2e 44, lint 12(전부 예전부터 있던 것).

| # | 작업 | 지금 문제 | 정석 방식 | 크기 |
|---|---|---|---|---|
| **1** ✓ | **되돌리기 나누기**(§14, §18.1) | ⌘Z가 누가 했든 마지막 변경을 되돌린다 → Claude가 쓴 것을 모르고 지우거나, 그 반대 | ⌘Z = 번역자의 것만(구글 독스·Yjs `trackedOrigins`). Claude의 것 = 대화에서 그 쓰기를 골라 "여기부터 되돌리기"(Claude Code `/rewind`처럼 선형, `ops.tool_use_id`로 이미 이어져 있다). 그 뒤 다른 쪽이 같은 단락을 고쳤으면 되돌리지 않고 이유를 말한다 | 큼 |
| **2** ✓ | **번역 검사**(6단계, §5, §19) | Claude가 쓴 번역이 용어집을 어겨도 아무도 모른다 | 앱이 검사(`checkSegments`: missingTerm·emptyTarget·ratio·unplacedNote)하고 기록. Stop hook이 실패를 돌려보내고 횟수는 앱이 센다(TRIES=3, hook은 fail-open이므로 진실은 `agent_turn`) | 중~큼 |
| 3a ✓ | 대화 도중 모델·강도 바꾸기(§21) | 첫 메시지 전에만 | SDK `Query.setModel()` + 프로토콜 `configure` | 작음 |
| 3b | 대화 제목 자동 갱신 | 메뉴를 열어야 Claude Code의 제목으로 바뀜 | 서버가 제목을 정하면 `/live`로 알림 | 작음 |
| 3c | 실제 책 한 장으로 리뷰·OCR 실측 | Gatsby 5단락 값뿐 | 한 장 돌려 시간·비용·품질 기록, 상한(60턴·$5)·지시문 조정 | 작음 |
| 4 | 작업 진행 표시가 새로고침에 사라짐 | "Claude is reading the chapter…"가 없어짐(제안은 옴) | 서버가 진행 중인 작업 대화를 알려 주고 화면이 다시 따라감 | 작음~중 |
| 5 | 예전부터 있던 lint 12개 | | 하나씩(effect 안 setState, render 중 ref 읽기) | 작음~중 |
| 6 | 재시작 뒤 첫 턴의 비용이 누계로 보임(§8, 2026-10-19 측정) | 서버를 다시 켜고 이어 간 대화의 첫 턴이 그 대화 전체 비용을 보인다 | 다시 연 대화의 `spent`를 세션 파일이 저장한 누계에서 시작(§24: 기록된 턴 비용의 합은 이 버그로 이미 부풀었다) | 작음 |

### 18.1 되돌리기 나누기 — 만드는 순서 (행 = 커밋)

| # | 무엇 | 파일 | 확인 |
|---|---|---|---|
| 0 ✓ | 갤러리: Claude의 변경을 되돌리는 자리(Trace의 "Wrote the translation of ¶3" 줄 / 턴 끝 / 둘 다), ⌘Z가 Claude의 변경을 건너뛸 때의 알림 | `app/src/gallery/` | 번역자 확인 |
| 1 ✓ | 변경이 건드린 것(`touches`)과 뒤의 겹침 판정 — 마이그레이션 없음(위 "판정을 바꿨다") | `server/commands.mjs` | 모든 명령이 앞뒤로 빠짐없이 |
| 2 ✓ | 번역자의 ⌘Z·⌘⇧Z는 번역자의 op만. 되돌릴 op 뒤에 Claude가 같은 단락을 고쳤으면 되돌리지 않고 그렇다고 답한다. 새 쓰기는 같은 쪽의 다시 하기만 지운다 | `commands.mjs`, `index.mjs`, `app/src/data/useBook.ts` | 서버 테스트(두 쪽이 섞인 스택), e2e |
| 3 ✓ | Claude의 변경 되돌리기: 고른 쓰기부터 그 뒤 Claude의 op를 최근 것부터(충돌에서 멈추고 말한다) | `commands.mjs`, `index.mjs`, `features/agent/Thread.tsx` | 서버 테스트 + e2e(녹화 프레임) |
| 3.5 ✓ | 화면: ⌘Z·⌘⇧Z가 거절되면 오류가 아니라 경고 알림(누가 무엇을 바꿨는지 + Claude 탭에서 먼저 되돌리라고) | `app/src/data/useBook.ts` | e2e `undo.spec`(Claude의 쓰기는 e2e 사본에 도구처럼 직접) |
| 3.6 ✓ | 화면: Claude 탭 턴 끝의 Undo from here(B안) | `api.ts`, `http.ts`, `useClaude.ts`, `Thread.tsx`, `lib/trace.ts` | e2e |
| 4 ✓ | README·이 문서 | | |

**결과**(2026-10-19): 서버 테스트 187, 화면 단위 62, e2e 48(새 4: ⌘Z가 Claude 것을 건너뜀·거절, Undo from here·거절). 진짜 책의 Claude 변경은 하나였고 도구 호출 id가 붙어 있었다(되돌리기 가능).

**정한 것**(2026-10-19, 갤러리 `?gallery&undo`): Claude의 변경은 **턴 끝의 Undo from here**(B안)로, 그 턴부터 이 대화의 끝까지. ⌘Z가 Claude의 변경을 건너뛸 때 알리지 않는다. 되돌린 Claude의 변경은 다시 하지 않는다(Claude Code의 rewind처럼).

**판정을 바꿨다**: 단락 버전 대신 "**무엇을 건드렸나**"(`touches`: 단락의 글, 용어, 댓글 스레드, 역주, 제안)로 본다. 댓글·용어집·역주는 바뀌어도 단락 버전이 그대로라 버전으로는 못 잡는다. 건드린 것은 기록(`ops`)의 정방향 인자에서 읽으므로 마이그레이션이 없고 지난 기록에도 맞다. 규칙: 되돌리거나 다시 하려는 변경 **뒤에 기록된, 아직 서 있는 변경**(누구 것이든, 함께 되돌리는 것은 빼고)이 같은 것을 건드렸으면 거절하고 누가 무엇을 바꿨는지 말한다. 단락의 댓글은 그 단락의 글이 아니다.

### 18.2 정할 것 (번역자)
| 작업 | 질문 |
|---|---|
| 1 | Claude의 변경 되돌리기 버튼의 자리(갤러리 0행으로 보고 정한다) |
| 1 | ⌘Z가 Claude의 변경을 건너뛸 때 알릴지 |
| 1 | "Claude의 변경 되돌리기"가 지금 대화의 것만인지, 모든 대화의 것인지 |
| 2 | 검사에 걸리면 Claude에게 바로 돌려보낼지, 번역자에게 먼저 보일지 / 길이 비율의 기준 |

시작 전: 번역자의 서버를 새 코드로 다시 켠다(`node server/index.mjs`).

## 19. 번역 검사 (6단계, 2026-10-19 계획)

Claude가 번역을 넣으면 앱이 검사하고, 틀리면 Claude에게 돌려보낸다(같은 턴, 최대 3번). 돌려보낸 뒤 Claude가 아무것도 다시 쓰지 않고 끝내면("이대로가 맞다"고 답한 것) 다시 돌려보내지 않는다 — 남은 것은 번역자가 판단한다. 결과는 턴 끝에 보이고 턴 기록에 남는다. 검사는 **그 턴에 Claude가 쓴 단락만**. 규칙: **용어집 표기**(화면의 `missingTerms`와 같은 규칙: 용어가 원문에 있으면 합의된 번역이나 대체 표기 중 하나가 번역문에 있어야), **역주 자리**: 번역 안에 자리가 있던 원주·역주의 그 구절이 사라진 것만(Claude가 번역을 통째로 다시 쓰면 생긴다). 아직 자리가 정해진 적 없는 원주는 넣지 않는다 — Claude에게 역주 자리를 놓는 도구가 없어, 돌려보내도 고칠 수 없다. 빈 번역은 도구가 이미 거절하므로 빼고, 길이는 기준을 세울 번역이 아직 없어(실제 책 번역 단락 2개) 이번엔 넣지 않는다.

| # | 무엇 | 파일 | 확인 |
|---|---|---|---|
| 0 ✓ | Stop hook을 fitz의 설정으로 잰다 | `.context/measure/stop-hook.mjs` | §8에 기록 |
| 1 ✓ | 검사 규칙(순수): `checkSegments(db, ids)`, 돌려보낼 글 `reasonFor`. 용어집 규칙은 한 곳(`glossaryRule.mjs`)에 두고 화면의 노란 경고·서버의 읽기 도구·검사가 함께 쓴다(화면은 `fold.mjs`처럼 그 파일을 가져온다) | `server/agent/checks.mjs`, `glossaryRule.mjs`(+`.d.mts`), `app/src/lib/glossary.ts`, `agent/tools.mjs`, `app/vite.config.ts` | 순수 테스트 5, 화면의 용어집 테스트가 그대로 통과 |
| 2 ✓ | 기록: 턴마다 검사 결과 `{ checked, rounds }`(검사할 때마다 찾은 실패들 — 마지막이 판정, 그 앞의 수가 돌려보낸 횟수), 화면이 묻는 경로 `turnChecks`. 작업 DB는 백업 뒤 마이그레이션(`out/book.db.bak-2026-10-19-before-turn-checks`) | `db/schema.sql`·`pipeline/migrate.py`(작업 DB 백업), `agent/records.mjs`, `index.mjs` | pytest + 서버 테스트 |
| 3 ✓ | Stop hook: 그 턴에 Claude가 쓴 단락 → 검사 → 실패면 이유를 붙여 돌려보냄(앱이 횟수를 센다, `TRIES = 3`), 턴 끝에 기록, 멈춘 턴은 기록하지 않음, 검사가 못 돌면 "could not check"로(통과가 아니다). 쓴 단락은 스트림이 아니라 쓰기 도구가 쓰는 그 자리에서 알린다(`wrote`): hook은 스트림의 마지막 도구 결과보다 먼저 불릴 수 있다 | `agent/session.mjs`, `agent/host.mjs` | 스텁 세션 |
| 4 ✓ | 화면: 턴 끝에 ✓/✗와 돌려보낸 횟수(기록을 묻는다 — 스트림의 돌려보냄 메시지는 세션 파일에 남지 않으므로 다시 열 때도 같도록) | `api.ts`, `http.ts`, `useClaude.ts`, `Thread.tsx`, `lib/trace.ts` | e2e |
| 5 ✓ | 진짜로 한 번(용어집을 어기게 해서 돌려보냄 → 고침) | `.context/real/checks-real.spec.ts` | 실측(아래) |
| 6 ✓ | README·이 문서 | | |

**실측**(2026-10-19, 커밋한 코드를 따로 꺼내 돌림(A, B는 dc37a60, C, D는 53b548b + 고친 글), Haiku 5.5 · low, Gatsby 1장, 용어집 `advantages → 혜택`). 화면에서 ¶3을 번역하게 한 뒤, 번역자가 "advantages를 '유리한 조건'으로 바꿔서 다시 넣어줘"라고 한다. 같은 요청을 네 번 돌렸고 Claude는 두 길을 다 갔다:

| | 1턴: ¶3 번역 | 2턴: 용어집과 다른 표기를 요청 |
|---|---|---|
| A | 읽기에서 용어집을 보고 '혜택'으로 씀 → ✓ `Checked ¶3`(8초, $0.0010) | '유리한 조건'으로 쓰고 용어집과 다르다고 덧붙임 → 돌려보냄 → "번역자가 직접 지정했으므로 지금 번역이 맞다"고 답하고 아무것도 쓰지 않음 → 다시 돌려보내지 않음 → ✗ `1 problem left after 1 try`(13초, $0.0009). 위 규칙(dc37a60)이 없었다면 같은 답을 받으며 세 번까지 돌려보냈을 것 |
| B | ✓ `Checked ¶3`(10초, $0.0009) | 돌려보냄 → '혜택'으로 다시 씀(쓰기 승인 2번) → ✓ `Checked ¶3 · fixed after 1 try`(31초, $0.0020) |
| C, D | ✓ `Checked ¶3`(17초 $0.002 / 15초 $0.0014) | 돌려보낸 글을 고친 뒤(아래). 둘 다 "번역자가 요청한 표기라 그대로 둔다"고 답하고 멈춤 → ✗ `1 problem left after 1 try`(13초 $0.001 / 15초 $0.0011) |

B는 번역자가 직접 요청한 표기를 검사 때문에 용어집 표기로 되돌렸다(쓰기 승인을 번역자가 거절하면 막을 수는 있다). 검사는 Claude의 실수를 잡는 것이지 번역자의 말을 뒤집는 것이 아니므로, 돌려보내는 글의 "그대로가 맞으면"에 **"번역자가 요청한 표기"**를 예로 넣었다(C, D). 그때 용어집과 다르다는 사실은 ✗ 줄로 번역자에게 보인다.

결과는 모두 턴마다 하나, 기록(`agent_turn.checks`)은 판정과 같고, 대화를 다시 열어도 같은 줄이 보인다(B~D에서 확인). 실전 세션 4개는 `deleteSession`으로 지우고 `~/.fitz/sessions`의 사본도 지웠다.

## 20. 대화 프롬프트 — 동료 번역가 (2026-10-19)

프롬프트를 둘로 나눴다(`session.mjs`). 작업 대화에는 웹 검색과 쓰기 도구가 없는데, 같은 프롬프트가 그것들을 쓸 수 있다고 말하고 있었다. 책에 닿는 길(도구 넷, PDF는 볼 수 없다)은 둘이 함께 쓴다.

대화 프롬프트는 "번역을 아는 조수"에서 "의견을 말하는 동료 번역가, 다만 번역은 번역가의 것"으로. 일하는 방식에 더한 것: 뜻이 먼저 / 번역인 줄 모르게 읽히는 한국어 / 지금까지의 번역이 스타일 가이드 / 이름·용어·반복 표현은 `search`로 다른 곳을 먼저 보고 말한다 / 추천 하나 / 왜 그 말인지, 결정짓는 단어 한두 개의 맥락으로(이 문맥의 뜻, 그것을 정하는 근거, 사전의 첫 뜻보다 맞는 이유, 원문 인용) / 고칠 만큼만 / 근처의 분명한 문제는 끝에 / 모르는 것은 모른다고. 책마다 다른 방침(대상 독자, 경어체, 외래어 표기, 역주)은 넣지 않는다: 지금까지의 번역에서 배우고, 따로 둔다면 번역 방침 문서로.

**실측**(실제 책 사본, Opus 5.5 / medium, `record.mjs`; 녹화는 `.context/agent-runs/prompt-*`, 커밋하지 않음). 같은 질문 셋: ¶36 뉘앙스, ¶826 옮기기, ¶2 uptown.

| | 전 | 후 |
|---|---|---|
| `search` | 0/3. "뒤에 다시 나온다면"처럼 짐작 | 3/3. uptown 4곳(¶169가 뜻을 풀어 준다), ripes 20여 곳(2장 제목, ¶56의 정의 → 용어집 제안), Bessarabia·Moldavia는 이 단락뿐(→ 용어집 불필요) |
| 답의 모양 | 후보 여럿(추천 표시) | 추천 하나 + 결정짓는 단어의 맥락 근거. ¶2의 끊어 쓴 문장을 근거로 같은 리듬 |
| 글자 수 (¶36 / ¶826 / uptown) | 2,148 / 1,576 / 1,191 | 1,906 / 1,475 / 1,134 |
| 비용·시간 | $0.079·31초 / $0.084·32초 / $0.055·20초 | $0.099·33초 / $0.122·37초 / $0.076·25초 |

첫 판의 "search for where else it appears"로는 `search`를 한 번도 부르지 않았다(0/3) → "call search with its English first … rather than guessing whether it comes up again"으로 고친 뒤 3/3. 작업 프롬프트: 실제 테스트 3 통과, 리뷰 녹화(Gatsby, Sonnet 5.5 / low)는 심어 둔 ¶4 오역을 찾고 하나(veteran 누락)를 더 찾았다.

## 21. 대화 도중 모델·강도 바꾸기 (§18 3a, 2026-10-19 계획)

지금은 새 대화의 첫 메시지 전에만 고른다. Claude Code의 `/model`·`/effort`처럼, 열린 세션에 SDK가 주는 대로 바꾼다: 모델은 `Query.setModel`, 강도는 `Query.applyFlagSettings({ effortLevel })`(측정 §8; `setMaxThinkingTokens`는 SDK가 폐기 예정으로 둔 것). 바꾼 값은 다음 메시지부터. 답하는 중에는 바꾸지 않는다(화면이 잠그고 서버도 거절). 책 DB의 대화 기록도 바꿔, 서버를 다시 켜면 `resume`이 그 값으로 연다. Claude Code가 떠 있지 않으면 기록만 바꾼다(다음 메시지가 그 값으로 연다). Claude Code에 알리지 못하면 기록도 바꾸지 않고 이유를 알린다 — 기록과 실제가 어긋나지 않게. 작업(리뷰·OCR)은 제 모델을 쓴다. 화면은 새 대화에서 쓰던 그 메뉴를 대화 중에도 연다 — 새 요소가 없어 갤러리는 두지 않는다.

| # | 무엇 | 파일 | 확인 |
|---|---|---|---|
| 0 ✓ | SDK로 잰다(§8) | `.context/measure/set-model.mjs`, `flag-merge.mjs` | §8에 기록 |
| 1 ✓ | 서버: 세션의 `configure`, 기록 `setConfig`, 프로토콜 `configure`(→) · `configured`(←) · snapshot에 모델·강도, host의 `configure`(답하는 중 409, 작업 400, 알리지 못하면 기록도 그대로), `/live` 연결. 턴이 끝났다는 표시(`conv.turn = null`)는 턴 기록을 남기다 실패해도 먼저 지운다 — 답하는 중인지를 그것으로 보므로 | `agent/session.mjs`, `records.mjs`, `protocol.mjs`, `host.mjs`, `live.mjs` | 스텁 세션: 서버 테스트 209 |
| 2 ✓ | 화면: 대화 중에도 모델·강도 메뉴(답하는 중 잠김), 값은 서버가 알린 것(snapshot, 그다음 `configured`; 그 전에는 목록의 값) | `api.ts`, `http.ts`, `lib/conversation.ts`, `useClaude.ts`, `Composer.tsx` | 화면 단위 64, e2e 52 |
| 3 ✓ | 진짜로 한 번(Haiku로 묻고 Sonnet으로 바꿔 다시 묻기), README·이 문서 | `.context/real/model-real.spec.ts` | 실측(아래) |

**실측**(2026-10-19, 커밋 4976f06을 따로 꺼내 돌림, Gatsby 1장). 화면에서 Haiku 5.5 · low로 ¶4의 한 구절을 묻고(5초, $0.0006), 메뉴로 Sonnet 5.5 → high로 바꿔 다시 물었다(2초, $0.024; 답하는 동안 메뉴는 잠김). 세션의 assistant 메시지는 Haiku 셋 다음 Sonnet 하나 — 같은 Claude Code 프로세스에서 바뀌었다. 책 DB의 대화는 `claude-sonnet-5-5`/`high`, 새로고침해 다시 열어도 메뉴가 Sonnet 5.5 · high. 세션은 지웠다.

## 22. 화면 구성 — sidebar-07 사이드바와 Claude 전용 패널 (2026-10-19)

갤러리 `?gallery&shell`(승인). 오른쪽 패널의 탭 다섯(History·Find·Glossary·Notes·Claude)은 범위가 다른 것들을 한 상자에 담고 있었다(문단·책·책·문단과 책·대화). 각자 범위의 자리로 보내고 오른쪽에는 Claude만 남겼다. shadcn 블록의 규칙을 따른다: 사이드바는 어디로 갈지(와 검색), 머리줄은 breadcrumb와 동작, 문단에 딸린 것은 그 문단에서.

| 있던 곳 | 간 곳 |
|---|---|
| 머리줄의 Review·Translate·Export 탭 | 사이드바의 단계(장 목록 위, 책 전체 진행률). 머리줄은 단계 › 장 ▾(사이드바를 아이콘으로 접어도 장을 바꾼다) |
| Find 탭 | 사이드바 맨 위 Find in book: 결과가 장 목록 자리에, Esc로 돌아온다(VS Code의 검색 보기) |
| Glossary 탭 | 사이드바 아래 Glossary 페이지(표). Translate에서는 원문의 용어 밑줄을 눌러 그 자리에서 |
| History 탭 | 선택한 문단의 History 버튼(편집 점 자리) |
| Notes 탭: 댓글 | 표시를 누르면 그 자리(Popover). 장의 댓글 전부와 문단 전체에 단 댓글은 상태줄 Notes |
| Notes 탭: 역주·저자 주 | Translate에서 번역문 아래 각주 칸 |
| Notes 탭: 미연결 저자 주 | 상태줄 Notes → Link(문단 고르기 대화상자) |
| Claude 탭 | 탭 없는 Claude 패널, 머리줄 ✦로 여닫음 |

| 정한 것 | 왜 |
|---|---|
| 용어 밑줄을 눌러 고치는 것은 Translate에서만 | Review에서 클릭은 그 자리 편집의 시작이다. 자주 나오는 이름 근처를 고치기 어려워진다(기존 e2e 둘이 실패해서 알았다) |
| History는 점 클릭이 아니라 선택한 문단의 버튼, 점 자리에 | 점은 원문을 고친 문단에만 있어 번역만 고친 문단의 기록에 닿지 않는다. 점 옆에 두면 1440px에서 Review 문단 머리줄이 두 줄로 넘어간다(여유 7px) |
| 상태줄은 Notes 하나: 열린 댓글 수와 단계의 수(Review는 미연결, Translate는 미번역 저자 주) | 셋을 따로 두면 Translate 상태줄이 1280px에서 넘친다(원래 여유 12px). Suspects는 OCR 검수의 수라 Review에서만 |
| 미연결 주의 Link는 목록을 닫고 대화상자를 연다 | 대화상자 안의 클릭은 Popover 밖의 클릭이라, 목록이 닫히며 그 안의 대화상자도 사라진다 |
| 각주가 "붙은 자리"는 본문 번호와 같은 기준(번역문에서 그 말이 찾아지는가) | 옛 번역의 앵커가 남은 주가 "붙음"으로 보였다 |
| ✦로 닫은 것도 새로고침 뒤 기억 | 레이아웃 저장(`useDefaultLayout`, 사용자 변경만)은 코드의 collapse를 사용자 변경으로 치지 않는다 → 그 변경에 `isUserInteraction: true`. 열려 있는지는 패널이 정하고 버튼은 바꿔 달라고만 한다(페이지를 열 때는 남겨 둔 그대로) |
| 닫힌 패널의 내용은 `hidden` | 0px로 잘리기만 하면 Tab 순서와 화면 낭독에 남는다 |
| e2e는 영역으로 좁혀 찾는다: 장은 `navigation "Chapters"`, 찾은 것은 `region "Find results"`, 단계는 이름 그대로(exact) | breadcrumb에 같은 이름의 장 버튼이 생겼다. shadcn SidebarRail도 "Toggle Sidebar"라 토글은 exact |

Claude 패널의 글자(같은 날, 758a87a): 읽는 글 14px, 조작·상태 12px, 버튼 24px(보내기 28px). 10·12·13·14px 넷과 20·24·28px 셋이 섞여 있었다. 입력창은 13px로 적혀 있었지만 Textarea의 `md:text-xs`가 이겨 12px였다.

### 22.1 만든 순서 (행 = 커밋)

| # | 무엇 | 커밋 | e2e |
|---|---|---|---|
| 0 | 갤러리, Claude 패널 글자 | bd7a5dc, 758a87a | |
| 1 | 사이드바(sidebar-07), 머리줄 breadcrumb | ce85cb8 | 52 |
| 2 | Find → 사이드바 / Translate에서도 찾은 문단으로 | a8daf43 / fd50407 | 53 / 54 |
| 3 | Glossary → 페이지, 용어 밑줄 / SpellMark의 콘솔 경고 | 98d514c / 623e4e3 | 55 |
| 4 | History 버튼 | 7803edd | 56 |
| 5 | 댓글은 표시 옆과 상태줄 Notes / 각주는 번역문 아래, Notes 탭 제거 | cfe7bba / 4fe4e9e | 56 / 59 |
| 6 | 오른쪽은 Claude 전용, ✦ | 38dbf9c | 60 |
| 7 | 버튼 24px·글자 12px: 여유 있는 곳 / 문단 종류를 메뉴로(Review 머리줄이 1280·1440·1680px에서 한 줄) / 상태줄(긴 장 제목이 줄어듦, 단축키 안내는 1440px부터) | aa6e7bc / 677ef9e / 3de5d2a | 63 |

같은 작업 폴더에서 다른 세션들이 일하는 중이라, 커밋마다 HEAD에 그 커밋의 파일만 얹은 임시 worktree에서 e2e 전체를 돌렸다(e2e 수에는 그 사이 다른 세션이 더한 테스트도 들어 있다). 버튼은 이제 앱 전체가 24px·글자와 아이콘 12px이다(Session 페이지는 그 세션이 f9cc3ac에서). 토글도 높이는 이미 24px였지만 글자가 10px라 12px로 맞췄다.

## 23. 다시 열린 페이지도 서버와 같게 — 작업의 진행과 대화의 제목 (2026-10-19 계획)

원칙(하네스): 사실은 서버가 갖고 페이지는 묻는다. 새로 열리거나 다시 붙은 페이지는 서버가 있는 곳에서 끝나야 한다(§17 "중간에 연 창도 서버와 같은 상태"). 두 군데가 어긋난다.

| 무엇 | 지금 | 왜 어긋나나 |
|---|---|---|
| 작업(리뷰·OCR 오류)의 진행 | 시작한 페이지의 `runs`만 "돌고 있음"을 안다. 새로고침하면 잊는다(서버는 계속 돌리고 제안은 `suggested`로 온다). 서버가 그사이 다시 켜져 작업이 죽으면, 다시 붙은 페이지는 "읽는 중"에 영원히 남는다 | 서버가 "일하는 중"을 말해 주지 않는다: 목록에도 snapshot에도 없다 |
| 대화의 제목 | 서버는 턴이 끝나면 `getSessionInfo`로 받아 기록하지만, 페이지는 목록을 다시 받을 때(대화 메뉴를 열 때)에야 안다 | 기록할 때 따라가는 쪽에 말하지 않는다 |

| 정한 것 | 왜 |
|---|---|
| 대화가 "일하는 중" = 턴이 가고 있고(`conv.turn`) 그 Claude Code가 살아 있다(`conv.session`). 서버 메모리의 사실 | fold의 `status`는 첫 SDK 메시지 전에는 idle이다(작업이 막 시작했을 때). 프로세스가 죽으면 `session`이 비므로 끝난 것이 된다 |
| 목록(`conversations`)의 항목과 `snapshot`에 `working` | 페이지는 처음 열릴 때와 다시 붙을 때 목록을 묻고, 일하는 작업 대화를 따라간다(`open`). snapshot과 그 뒤의 메시지가 진행을 잇는다(`nextRun`) |
| `snapshot`이 `working: false`인데 끝난 턴이 없으면, 작업은 답하지 못하고 끝났다(failed) | 서버가 다시 켜져 프로세스와 함께 죽은 작업. 지금은 "읽는 중"에 남는다 |
| 제목을 기록하는 순간 따라가는 쪽에 `titled { convId, title }`, `snapshot`에도 `title` | 나중에 여는 페이지도 같은 제목. 목록은 메뉴를 열 때 지금처럼 새로 받는다 |
| 다른 창이 시작한 작업을 이미 열린 창이 바로 듣게 하는 것(모든 페이지에 알림)은 하지 않는다 | 이번 문제는 새로고침과 다시 붙기. 그 창도 다음에 열리거나 붙을 때 목록에서 안다 |

### 23.1 만드는 순서 (행 = 커밋)

| # | 무엇 | 손댈 곳 | 확인 |
|---|---|---|---|
| 1 | 이 절 | `docs/agent.md` | |
| 2 | 작업의 진행: `working`, 페이지가 목록을 묻고 일하는 작업을 따라감, 답 없이 끝난 작업 | `host.mjs`, `protocol.mjs`(주석), `http.ts`, `useBook.ts`, `lib/taskRun.ts` | 서버(가짜 세션): 목록·snapshot의 `working`, 결과 뒤와 프로세스가 죽은 뒤 false. 화면 단위: `nextRun`. e2e: 리뷰 중 새로고침해도 "읽는 중", 결과가 오면 제안 수 |
| 3 | 대화의 제목: `titled`, snapshot의 `title` | `host.mjs`, `protocol.mjs`(주석), `lib/conversation.ts`, `ClaudeTab.tsx` | 서버: 따라가는 쪽이 `titled`를 듣고 다시 열면 snapshot에. 화면 단위: `applyEvent`. e2e: 메뉴를 열지 않아도 머리줄의 제목이 바뀜 |

## 24. 이어 연 Claude Code의 첫 턴 비용 (2026-10-19 계획, §18 6행)

원칙(하네스): Claude Code가 주는 것은 그대로 쓰고, 없는 것만 만든다. 턴의 비용은 fold가 `total_cost_usd`(프로세스의 누계)의 차이로 구한다(§8). 이어 연(`resume`) 프로세스의 누계는 0이 아니라 세션 파일이 저장한 누계에서 시작한다. 그런데 앱의 `spent`는 서버를 다시 켜면 0에서 시작한다. 그래서 첫 턴이 대화 전체의 비용을 보인다.

측정(2026-10-19, Claude Code 2.1.302, SDK 0.3.302; 번역자의 세션 파일 7개를 읽기만, `out/book.db` 복사본과 비교):

| 사실 | 근거 |
|---|---|
| Claude Code는 프로세스가 끝날 때 세션 파일 끝에 `{"type":"cost-state", "totalCostUSD", …}` 한 줄을 쓴다. 서버를 끌 때(SIGINT/SIGTERM → `close()`가 끝나기를 기다림)도 쓴다 | 프로세스 하나였던 세션 다섯: `cost-state` = 기록된 턴 비용의 합(1d513d5d $0.0379, 46da6c08 $0.1547, …). 지금 도는 세션(5eeb0270)에는 아직 없다 |
| 이어 연 프로세스의 누계는 마지막 `cost-state`에서 이어진다. 없으면 0(SDK `total_cost_usd` 설명: "continues from the total its transcript saved, when it has one") | 90525222: 첫 프로세스가 끝나며 $0.5143(그 앞 10턴의 합과 같음). 다시 켠 뒤 첫 턴의 기록은 $0.6913 = $0.5143 + 실제 $0.1770 |
| 기록된 턴 비용의 합은 믿을 수 없다 | 90525222의 합 $1.4328 = 마지막 `cost-state` $0.9185 + 부풀린 $0.5143. 그 합에서 시작하면 다음 재시작 뒤 첫 턴은 음수가 된다 |
| SDK의 읽기 함수는 이 줄을 주지 않는다 | `getSessionMessages(id, { includeSystemMessages: true })`도 user·assistant 87개뿐 |

| 정한 것 | 왜 |
|---|---|
| Claude Code가 돌지 않는 대화의 `spent` = 세션 파일의 마지막 `cost-state`의 `totalCostUSD`(없으면 0) | 다음에 이어 열릴 Claude Code가 바로 그 값에서 센다. 기록의 합과 달리 지난 버그나 중간에 죽은 프로세스에 흔들리지 않는다 |
| 정하는 때: 서버를 다시 켜고 대화를 읽어 올 때, 서버가 켜진 채 프로세스가 끝났을 때(죽었을 때) | 죽은 프로세스는 `cost-state`를 못 썼을 수 있다. 그때 다음 프로세스는 그 앞의 값에서 센다. 끝나는 때에 바뀌었으면 따라가는 쪽에 snapshot을 보낸다(페이지의 fold도 같은 `spent`로 센다) |
| 그 한 줄은 앱이 읽는다: `keep.mjs`에 `savedCost` | 세션 파일이 어디 있는지 아는 곳. 그 밖에는 여전히 읽지 않는다. 형식이 바뀌어 못 찾으면 0: 지금과 같은 증상으로 돌아갈 뿐 더 나빠지지 않는다 |
| 이미 부풀려 기록된 턴(90525222의 한 턴)은 손으로 한 번 고쳤다(2026-10-19, 번역자 요청): $0.6913184 − 첫 프로세스의 `cost-state` $0.514336 = $0.1769824. 앞 10턴의 합 = $0.514336, 고친 뒤 전체 합 = 마지막 `cost-state` $0.9184754. 백업 `out/book.db.bak-2026-10-19-before-cost-fix` | 프로세스가 둘 이상이었던 세션은 이것 하나뿐이었다(세션 파일 7개 전부 확인). 코드로 일반화하지 않는다: 이 버그 뒤로는 생기지 않는다 |
| 오류 결과의 누계가 0으로 오는 경우(SDK 설명 "Crash/startup-error results may carry zeroed values")는 이번에 다루지 않는다 | 다른 문으로 들어오는 다른 증상. 본 적이 없다 |

### 24.1 만드는 순서 (행 = 커밋)

| # | 무엇 | 손댈 곳 | 확인 |
|---|---|---|---|
| 1 | 이 절 | `docs/agent.md` | |
| 2 | `savedCost`, 읽어 올 때와 프로세스가 끝날 때 `spent` | `keep.mjs`, `host.mjs` | `keep`: 마지막 `cost-state`, 없으면·깨진 줄·파일 없음은 0. 서버(가짜 세션): 재시작 뒤 첫 턴의 비용 = 그 턴이 더한 것, 죽은 프로세스 뒤도 같음, 바뀌면 snapshot. 실제 Claude(Haiku, 선택): 한 턴 → 서버 닫기 → 이어서 한 턴 |
