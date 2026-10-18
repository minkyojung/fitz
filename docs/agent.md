# fitz 번역 하네스 — 설계 (2026-10-18)

fitz는 번역 중인 책에 대해 일하는 Claude Code의 하네스다. Octave가 저장소에 대해 그렇듯이. 번역자가 단어와 뉘앙스를 묻기 위해 에디터 밖으로 맥락을 복사해 나가는 일을, Claude Code에게 책을 읽고 쓰는 도구를 주어 없앤다.

**기준 하나:** Claude Agent SDK가 이미 주는 것은 그대로 쓴다(세션, 스트리밍, 도구 실행 루프, 권한 묻기, hook, 구조화 출력, 비용 상한, 컨텍스트 압축). 없는 것만 짓는다(책을 다루는 도구, 번역 검증, 화면).

버전: `@anthropic-ai/claude-agent-sdk` **0.3.302**(고정), 동봉 바이너리 Claude Code 2.1.302, `zod` 4, `ws` 8.

## 0. 원칙

1. **모든 쓰기는 `server/commands.mjs`의 `execute()`를 지난다.** 에이전트의 수정도 ops 로그에 남고 ⌘Z로 돌아가며 `segment_version`에 스냅샷된다. 새 쓰기 경로를 만들지 않는다.
2. **텍스트만 나간다.** `tools: []`로 내장 도구(Read·Edit·Bash·Web)를 전부 떼므로 PDF와 쪽 이미지를 읽을 손이 모델에게 없다. 규칙이 아니라 구조로 지킨다. 도구 결과에 `image_path`·`source_pdf`·`boxes`가 없음을 테스트가 단언한다.
3. **모델의 말은 증거가 아니다.** 번역이 끝났다는 판단은 앱의 검증(`checks`)이 한다. 결과는 앱이 기록한다.
4. **상태 승격은 사람만.** 에이전트는 `draft`까지만 쓴다. `reviewed`·`final`은 사람이 ⌘Enter로.
5. **제안과 결정을 가른다.** 리뷰·오탈자 작업에는 쓰기 도구를 주지 않는다. 결과는 카드이고 수락은 클릭이다.

## 1. SDK에서 쓰는 것과 이유

| 옵션 | 값 | 왜 |
|---|---|---|
| `tools` | `[]` | 내장 도구 제거. 원칙 2 |
| `mcpServers` | `{ fitz: createSdkMcpServer({ name: "fitz", tools }) }` | 앱 프로세스 안에서 도는 MCP. 도구 이름은 `mcp__fitz__<name>` |
| `allowedTools` | 읽기 도구 7개 | 읽기는 묻지 않는다. 쓰기는 `canUseTool`로 온다 |
| `canUseTool` | 페이지에 승인 카드 | 쓰기 도구와 `AskUserQuestion`. "이 작업 동안 허용"은 앱이 기억 |
| `permissionMode` | `"default"` | bypass가 아니다. 쓰기는 물어야 한다 |
| `systemPrompt` | 문자열 | 코딩용 preset 불필요. 번역 하네스 프롬프트로 교체 |
| `settingSources` | `[]` | 사람의 `~/.claude`(CLAUDE.md·hook·MCP)가 섞이지 않는다 |
| `cwd` | 빈 스크래치 폴더(`~/.fitz/agent-cwd/`) | 세션 파일이 저장되는 키이자, 저장소·PDF 경로와 분리 |
| `includePartialMessages` | `true` | 글자 단위 스트리밍 |
| `prompt` | `AsyncIterable<SDKUserMessage>` (streaming input) | 대화 1 = `query()` 1. 여러 턴, `interrupt()`, `setModel()` |
| `resume` | 세션 id | 서버·앱 재시작 뒤 이어가기. 지난 메시지는 `getSessionMessages()`로 |
| `hooks.Stop` | 검증 게이트 | `{ decision: "block", reason }`로 같은 턴 안에서 되돌림 |
| `outputFormat` | `{ type: "json_schema", schema }` | 리뷰·오탈자의 결과. `result.structured_output` |
| `maxBudgetUsd`, `maxTurns` | 작업마다 | 상한 |
| `model`, `effort`, `thinking` | 명시 | 번역 `opus`/`medium`, 리뷰·오탈자 `sonnet`/`low`, `{ type: "adaptive" }` |
| `env` | `{ ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" }` | `env`를 주면 통째로 바뀌므로 펼쳐서. `USER`가 없으면 로그인을 못 찾는다 |
| `tool()`의 `extras` | `{ annotations: { readOnlyHint: true }, alwaysLoad: true }` | 읽기 도구는 병렬로 돈다. `alwaysLoad`로 `ToolSearch` 왕복을 없앤다 |

**인증.** SDK가 띄우는 바이너리는 환경에 `ANTHROPIC_API_KEY`가 있으면 묻지 않고 그 키를 쓰고, 없으면 Keychain의 Claude 로그인(이 Mac: Max)을 쓴다. 서버는 시작 시 `claude auth status`로 어느 자격으로 도는지 로그에 밝힌다. 약관(code.claude.com/docs/en/legal-and-compliance): 수정하지 않은 바이너리에 본인 구독으로 직접 로그인하는 것은 허용되며, Pro/Max 한도는 "Claude Code와 Agent SDK의 통상적 개인 사용"을 전제한다. 금지되는 것은 개발자가 자기 제품의 사용자들에게 claude.ai 로그인을 제공하거나 사용자 대신 구독으로 중계하는 것이다. fitz는 단일 사용자 로컬 도구다.

## 2. 구조

```
server/
  index.mjs             기존 JSON 라우트 그대로 + WebSocket /agent 하나
  commands.mjs          COMMANDS · execute · undo · redo  — 그대로. 에이전트의 모든 쓰기가 지난다
  agent/
    tools.mjs           MCP 도구 11개 = 기존 routes/commands의 얇은 포장
    session.mjs         query() 옵션 전부 명시. claude를 띄우는 유일한 파일
    fold.mjs            SDK 프레임 → 대화 상태. 순수 함수. 페이지도 같은 함수를 쓴다
    checks.mjs          앱이 돌리는 번역 검증. 순수 함수
    protocol.mjs        ClientMsg / ServerMsg 닫힌 union. 수신 시 모든 필드 검증
app/src/
  data/agent.ts         WebSocket 클라이언트 + fold
  features/agent/       패널 "Agent" 탭: 스레드, 라이브 라인, 승인 카드, 결과 카드, 비용
```

## 3. 도구 (MCP 서버 `fitz`)

읽기 — `readOnlyHint`, `allowedTools`, 묻지 않음:

| 도구 | 인자 | 돌려주는 것 |
|---|---|---|
| `get_book` | — | `{ id, title, author }` |
| `list_chapters` | — | `Chapter[]` (`listChapters` 라우트와 동일) |
| `get_segments` | `chapterId` 또는 `ids[]` | `{ id, idx, kind, pageStart, sourceText, targetText, status }[]` — `boxes` 없음 |
| `get_context` | `segmentId, before=3, after=3` | 앞뒤 단락 원문 + 이 단락 원문·번역문 + 걸린 용어 + 앵커된 저자 주 |
| `list_glossary` | — | `{ term, translation, aliases, kind }[]` |
| `list_notes` | `segmentId` | 저자 주·역주·댓글 |
| `search` | `query` | `search()` 결과 |

쓰기 — `canUseTool`로 묻는다. 전부 `execute()`:

| 도구 | → 명령 | 메모 |
|---|---|---|
| `set_translation(segmentId, text, expectUpdatedAt)` | `updateSegment { targetDoc: pmDoc(text) }` | 상태는 서버 규칙대로 `draft`. `updated_at`이 다르면 `isError`(사람이 그사이 고침) |
| `set_glossary_term(term, translation, aliases?, kind?)` | `setGlossaryTerm` | |
| `add_comment(segmentId, side, body, quote?)` | `addComment` | `quote`가 있으면 `makeAnchor`로 앵커 |
| `add_translator_note(segmentId, body, quote?)` | `addNote` | |

- 결과는 `structuredContent`로 돌려준다(모델은 JSON을 받는다). 모양은 `segRow`·`noteRow`·`commentRow`에서 `boxes`·경로만 뺀 것 — 화면 타입과 같다.
- 오류는 던지지 않고 `isError: true`로 모델이 읽을 문장을 준다.
- `pmDoc`(평문 → 문단 1개 doc)은 이미 있다. 여러 블록은 줄바꿈으로 가른다(`docText`의 역).

## 4. 작업 셋 — 프롬프트와 `outputFormat`만 다르다

| 작업 | 입력 | 도구 | 끝 |
|---|---|---|---|
| **번역** | 세그먼트 id들(선택 단락 또는 장) | 읽기 + `set_translation` (+ 용어 등록) | Stop hook이 `checks`를 돌린다 → 실패분을 되돌려 보낸다(TRIES = 3) → 통과해도 `draft`. 사람이 reviewed |
| **리뷰** | 번역된 단락 id들 | 읽기만 | `outputFormat`: `{ findings: [{ segmentId, severity, quote, issue, suggestion }] }` → 댓글 후보 카드, 사람이 "Add as comment" |
| **오탈자** | 장 | 읽기만 | `outputFormat`: `{ fixes: [{ segmentId, from, to, reason }] }` → 기존 SpellMark diff 모양으로 표시, 클릭 수락(`updateSegment`) |

자유 질문("이 단락 뉘앙스는?")은 어느 스레드에서나 가능하다. 도구는 읽기만.

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

## 7. 프로토콜 (WebSocket `/agent`)

```
Client → start { convId, task: "translate"|"review"|"typos"|"chat", ids, model }
         send  { convId, text }
         answer{ convId, requestId, decision: "allow"|"allowTask"|"deny", answers? }
         stop  { convId }
         open  { convId }
Server → snapshot { convId, state }          — 열 때 한 번
         frame    { convId, message }        — SDK 메시지 그대로(바이트 제거 뒤). 페이지가 같은 fold
         ask      { convId, requestId, tool, input }
         turn     { convId, turn }
         error    { convId?, message }
```

닫힌 union. 서버는 페이지가 보낸 어떤 필드도 믿지 않는다.

## 8. 측정된 SDK 사실 (claude-code-harness 스킬, Claude Code 2.1.287–2.1.296)

- Stop hook은 도구를 안 쓴 턴에도 매 턴 끝에 온다 → 앱의 "작업 중" 상태로 게이트한다.
- `block`은 같은 턴을 이어 간다. 사람은 턴 하나를 본다.
- MCP 도구는 기본으로 스키마가 미뤄져 첫 사용 전에 `ToolSearch`가 한 번 돈다 → `alwaysLoad: true`. 화면에서 `ToolSearch` 호출은 접는다.
- 실패·거절·멈춤의 `tool_use_result`는 객체가 아니라 문자열이다. fold는 두 모양을 다 받는다.
- `allowedTools`에 있는 도구는 `canUseTool`을 거치지 않는다.
- `env`를 주면 환경이 통째로 바뀐다. `USER`가 없으면 로그인을 못 찾는다.
- 이어 갈 때 지난 메시지는 흐름으로 다시 오지 않는다. `getSessionMessages`로 읽는다.
- `includePartialMessages`의 `stream_event` 순서: `message_start` → 블록 시작 → 조각 → 그 블록의 `assistant` → … → `message_stop`.
- 환경에 `ANTHROPIC_API_KEY`가 있으면 묻지 않고 쓴다.

## 9. 지금 하지 않는 것

| 것 | 이유 |
|---|---|
| Electron/Tauri 셸, worktree, PR, GitHub | 해당 없음. 나중의 Tauri 전환은 `server/`를 사이드카로 옮기면 된다 |
| 서브에이전트(`agents`), Workflow | 장 하나가 한 대화에 들어간다(825 세그먼트/26장). 커지면 단락 묶음 분배 |
| 바이너리 fetch·sha512·codesign | SDK 동봉분으로 충분. 배포 시 재검토 |
| 번역 스레드 영속화 | 댓글로 저장할 수 있다. 필요가 드러나면 |
| `web_search` | 인물·지명 확인에 가치 있으나 검색어에 원문이 나간다. 계약 확인 뒤 |
| 자동 reviewed/final | 절대 |

## 10. 빌드 순서 (행 = 커밋)

| # | 조각 | 사람이 보는 것 | 검증 | 결과 |
|---|---|---|---|---|
| 1 | 이 문서 + 의존성 | — | `pnpm test` 48 통과, SDK import, 바이너리 2.1.302 | 2026-10-18 완료 |
| 2 | `agent/tools.mjs` 읽기 도구 7 + 테스트 | — | 금지 필드 부재, `segOut`과 동일 | |
| 3 | `agent/session.mjs` + `fold.mjs` + 녹화 fixture 1개 | — | 첫 실전: "이 단락 뉘앙스 설명" 1회, 녹화 → `test/fixtures/` | |
| 4 | WS 라우트 + `protocol.mjs` + 페이지 Agent 탭 | 패널에서 질문, 스트리밍, Stop, 비용 | e2e(가짜 프레임) | |
| 5 | 쓰기 도구 4 + 승인 카드 | 번역 작업, 승인, ⌘Z로 되돌림 | e2e | |
| 6 | `checks.mjs` + Stop hook + `agent_turn` | "Checked" 줄, 되돌림 횟수 | 순수 테스트 + 스텁 세션 | |
| 7 | 리뷰·오탈자(`outputFormat`) + 결과 카드 | 댓글 후보, diff 수락 | e2e | |
| 8 | resume·재시작 복구, README | 껐다 켜도 이어짐 | e2e | |

## 11. 테스트

세 층, 전부 유지:
1. 순수 함수 — `tools`·`fold`·`checks`를 스크래치 DB와 **녹화된** 실제 세션 fixture로. 손으로 쓴 프레임만으로 테스트하지 않는다.
2. WS 라우트 — 세션을 스텁으로 주입.
3. 실제 화면 — Playwright, `/agent`를 가짜 프레임으로.

실제 모델은 3단계의 녹화 1회와 수동 확인에만 쓴다. 테스트는 `CLAUDE_CONFIG_DIR`를 임시 폴더로 주어 사람의 `~/.claude`와 실제 세션을 건드리지 않는다.
