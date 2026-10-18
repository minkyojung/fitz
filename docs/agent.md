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
| `allowedTools` | `mcp__fitz__book`, `__read`, `__glossary`, `__search` | 읽기는 묻지 않는다. 쓰기는 `canUseTool`로 온다 |
| `canUseTool` | 쓰기 도구 → host의 `ask`(번역자에게 묻는다), 그 밖 → 거절 | 답: 허락 / 이 세션 동안 항상(`addRules` + `destination: "session"`) / 거절. Claude Code가 제안하는 "항상" 규칙은 `localSettings` 파일에 적혀 대화가 끝나도 남으므로 쓰지 않는다 |
| `permissionMode` | `"default"` | bypass가 아니다. 쓰기는 물어야 한다 |
| `systemPrompt` | 문자열 | 코딩용 preset 불필요. 번역 하네스 프롬프트로 교체 |
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
  features/agent/       패널 "Agent" 탭: 스레드, 라이브 라인, 승인 카드, 결과 카드, 비용
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
- MCP 도구 결과가 25,000토큰(`MAX_MCP_OUTPUT_TOKENS`) 또는 50,000자를 넘으면 Claude Code는 결과를 파일로 옮기고 경로만 준다(문서 `[mcp]`). 이 에이전트에는 파일을 여는 도구가 없으므로(`tools: []`) 그 결과는 사라진 것과 같다 → 도구가 스스로 나눠서 돌려준다. 10,000토큰 넘으면 경고.

fitz에서 직접 잰 것 (Claude Code 2.1.302, SDK 0.3.302, 2026-10-18):

- **`settingSources: []`만으로는 격리되지 않는다.** claude.ai 로그인으로 돌면 사람이 claude.ai에 연결해 둔 커넥터(Gmail·Drive·Calendar·Notion…)가 **두 번째 요청부터** 붙었다(첫 요청 뒤에 연결이 끝난다). `getContextUsage()`: MCP tools 28,091토큰(fitz 도구 4개는 662). 사람의 스킬 19개가 목록에 실렸고 자동 메모리가 켜져 있었다. → `strictMcpConfig: true` + `settings.disableClaudeAiConnectors` + `skills: []` + `autoMemoryEnabled: false` + `disableBundledSkills`로 두 번째 요청이 31,871 → 2,610토큰(Haiku 측정). 남는 것: Claude Code에 들어 있는 플러그인 3개(`cc-plugin-*`)와 그 스킬 3개, `/` 명령 39개 — 모델에게 가는 도구는 fitz 4개뿐이다.
- **부모 Claude Code 세션의 환경이 따라온다.** 서버를 Claude Code 안(Octave의 터미널, Claude의 Bash)에서 띄우면 `process.env`에 `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`·`_TOKEN`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_EFFORT` 등이 있다. 그대로 넘기면 우리 에이전트가 남의 세션의 자식이 된다 → `ownEnv`.
- `allowedTools`에 이름을 넣은 도구가 있으면 **세션을 열 때마다** `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 경고가 난다. 의도한 것(읽기는 묻지 않는다)이므로 그대로 둔다. 읽기까지 `canUseTool`로 허락하면 경고는 없어지지만, 읽을 때마다 세션 상태가 `requires_action`으로 바뀌어 "답을 기다리는 중"이 깜빡인다.
- `tools: []`는 `ToolSearch`도 없앤다. 서버의 `alwaysLoad: true` 덕에 fitz 도구는 처음부터 실려 있어 문제없었다(init의 tools = fitz 4개).
- `result.total_cost_usd`는 프로세스의 누적값이다 → 턴의 비용은 직전 누적값과의 차.
- Opus 5.5 + `display: "summarized"`: 생각하는 동안은 `thinking_tokens`만 오고 요약 글은 거의 끝에 몰려 온다. 답의 글은 조각으로 흐른다.
- `for await`에서 `break`하면 query가 닫힌다. 턴 끝에 `getContextUsage()` 같은 걸 부르려면 루프 안에서 부른다.
- `deleteSession`은 세션 파일만 지우고 빈 프로젝트 폴더(`~/.claude/projects/<cwd>/`)를 남긴다.
- Claude Code가 MCP 도구의 "항상 허용"으로 주는 제안은 `addRules` → `localSettings`(파일)다. 그대로 돌려주면 `~/.fitz/agent/.claude/settings.local.json`에 적혀 다음 대화에서도 묻지 않게 된다 → 앱이 `destination: "session"` 규칙을 직접 만든다.
- 쓰기를 거절하면(`deny` + 메시지) Claude는 다른 길로 시도하지 않고 그 사실과 대안을 말했다(Haiku, 실제 책 사본: "다른 방식으로도 시도하지 않았습니다").
- 묻는 동안 `session_state_changed`가 `requires_action`, 답하면 `running`(녹화 `translate.jsonl`).
- **멈춘 턴**(`interrupt()`): `result`가 `terminal_reason: "aborted_streaming"`, `is_error: true`로 온다. 오류가 아니라 사람이 멈춘 것이므로 화면은 `reason`으로 가른다. 세션은 살아 있고 다음 메시지에 정상으로 답했다(Haiku, 실제 책 사본).

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
| 2 | `agent/tools.mjs` 읽기 도구 4 + 테스트 | — | 금지 필드 부재, 기존 함수와 같은 값 | 2026-10-18. 서버 테스트 62 통과. 실제 책: 26장 825단락을 `next`를 따라 39호출에 빠짐·중복 없이 읽음, 결과 최대 29,307자, 금지 필드 0 |
| 3 | `agent/session.mjs` + `fold.mjs` + 녹화 fixture 1개 | — | 첫 실전: "이 단락 뉘앙스 설명" 1회, 녹화 → `agent/fixtures/` | 2026-10-18. 서버 테스트 72. Gatsby ¶4 질문(Opus 5.5/medium): `read(ids:[4], around:3)` 1회 → 생각 → 답, 21초, $0.039, 요청 2,265·3,312토큰. 실제 책 ¶36: `read` + `glossary`, 34초, $0.080(격리 전 52초, $0.327). Claude가 앞뒤 단락·사람의 댓글·이미 번역된 단락의 문체를 근거로 답함 |
| 4 | WS 라우트 + `protocol.mjs` + 서버의 대화 관리(start·send·stop·open) + 터미널 대화 스크립트 `agent/chat.mjs` | 터미널에서 질문하고 답이 흐름 | 스텁 세션으로 프로토콜 테스트, 실제 1회 | 2026-10-18. 서버 테스트 84. 스텁 세션(녹화 메시지를 흘려 넣음)으로: 중간에 붙은 두 번째 페이지도 서버와 같은 상태, 다른 사이트 Origin은 401, 프로세스가 죽으면 다음 메시지에서 같은 세션 id로 resume. 실제: 서버(책 사본)에 `chat.mjs`로 ¶36 질문(Haiku) → `read(ids:[36], around:2)` → 답, 4.2초, $0.001. 6초에 멈춤 → `aborted_streaming`, 같은 대화의 다음 질문에 정상 답. 확인이 만든 세션 2개는 `deleteSession`으로 지움 |
| 5 | 쓰기 도구 4 + 승인 흐름(`canUseTool` → `ask` → `answer`) | 터미널에서 승인/거절, ⌘Z로 되돌림 | 스텁 세션 + 실제 1회 | 2026-10-18. 서버 테스트 102. 실제 책 사본(Haiku): "¶36을 번역해 넣어줘" → `read`·`glossary` → `set_translation` 미리보기 → 허락 → ¶36 draft, ops에 `updateSegment` 1행, `/api/undo`로 untranslated로 복귀. "Zemurray를 제머리로 등록" → 거절 → 등록 없음, Claude는 다른 길을 찾지 않고 현재 표기(샘 저머레이)와의 차이를 알림. 실제 책 쪽 두 턴: 9.7초 $0.002, 2.7초 $0.0004. Gatsby 녹화 `translate.jsonl`(Opus 5.5, 허락): `read` → `book` → `set_translation`, 13.7초, $0.062 |
| 5.5 | 쓰는 쪽이 둘인 책(§12): 버전 + 확인 / 변경 알림(처음엔 SSE, §15에서 `/live`로) / 에디터가 듣고 충돌에서 글을 지킴 | Claude가 쓰면 에디터에 바로 보이고, 겹치면 덮지 않고 알림 | 서버 테스트 + e2e | 2026-10-18. 커밋 셋. 서버 테스트 114, pytest 31, 화면 단위 34, e2e 30(새 3: 다른 쪽의 쓰기가 새로고침 없이 보임 / ⌘Enter 충돌 → 덮지 않음, "changed since" 임시본, Recover 후 저장 / Tab 충돌도 같음) |
| 6 | `checks.mjs` + Stop hook + `agent_turn` | 검증 결과와 되돌림 횟수 | 순수 테스트 + 스텁 세션 | |
| 7 | 리뷰·오탈자(`outputFormat`) | 정해진 모양의 목록 | 녹화 1회 | |
| 8 | resume·재시작 복구 | 서버를 껐다 켜도 이어짐 | 테스트 | |
| 9 | 페이지 Agent 탭(스레드·스트리밍·Stop·비용·승인 카드·결과 카드), 에이전트가 쓴 것을 에디터가 다시 읽기, README | 에디터 안에서 전부 | e2e(녹화 프레임) | |

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

지금 ⌘Z는 `ops`의 마지막 행을 되돌린다: Claude가 방금 쓴 것을 번역자의 ⌘Z가 되돌릴 수 있다.

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
