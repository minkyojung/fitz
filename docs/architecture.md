# fitz의 구조 방향 — 맥 데스크톱 앱, 그리고 로컬 모델까지 (2026-11-15, 2026-11-26 개정)

지금 제품에 얽매이지 않고 다시 설계하면 어떤 구조가 맞는가. 그 결론과 근거, 다시 볼 조건을 적는다. 아직 구현 전의 방향이다. 조사 원문(출처 링크 전부)은 `.context/reports/번역 SaaS 로컬 모델 아키텍처.md`와 `.context/research/1-auth.md`~`5-notes.md`에 있다(커밋하지 않음). 이 문서에는 결정에 쓰인 사실만 옮긴다.

**2026-11-26 개정.** 제품을 맥 전용 1인용 데스크톱 앱으로 정하고, 다른 번역가에게 배포한다. 처음 판(4db2dd4)에서 바뀐 것은 넷이다.
1. SaaS와 웹앱은 지금 하지 않는다. 그때의 설계는 §9에 출발점으로 남긴다.
2. 셸은 그대로 Electron이지만 고른 이유가 바뀌었다. 한국어 입력이 아니라 Agent SDK와 선례다(§2). 처음 판의 "Tauri는 한국어 입력 때문에 안 된다"는 xterm.js의 버그를 에디터 문제로 잘못 옮긴 것이었다. Safari 26 시험으로 바로잡았다.
3. Claude는 사용자 본인의 구독으로 쓴다(§4).
4. Rust는 독립된 부품에만 쓰고, PDF 가져오기 엔진부터 시작한다(§3).

## 1. 결론

앱 하나, 언어 하나(TypeScript), AI 출구 하나.

| 계층 | 선택 | 이유 |
|---|---|---|
| 셸 | Electron | 앱 안의 Node에서 Agent SDK가 그대로 돈다. Octave가 같은 SDK, 같은 인증, 같은 업데이트 방식으로 이미 배포 중이다(§2) |
| 화면 | React + TipTap | 지금 코드 그대로 |
| 앱 로직 | TypeScript, Electron 안의 Node(`utilityProcess`) | 지금 서버 코드(op log, 도구, 검사)를 그대로 옮긴다 |
| 원고 데이터 | op log + 문단별 version, 책마다 SQLite 파일 하나, `~/.fitz/` 아래 | 작성자별 되돌리기, AI 쓰기 검증, 책 단위 격리 — 지금 구조 그대로 |
| 원문 PDF·쪽 이미지 | 기기에만. 추출과 OCR도 기기에서 | 출판 계약 |
| Rust 부품 | 독립된 부품에만. 첫 번째는 PDF 가져오기 엔진 | §3. PyMuPDF(AGPL)를 바꿔야 하고, 입력과 출력이 분명하다 |
| AI 도구 | MCP 도구 서버 하나 | Claude와 로컬 모델이 같은 도구, 같은 규칙(`expectVersion`, 용어 검사)을 쓴다 |
| AI 출구 | 책 내용이 모델로 나가는 모든 길을 한 곳에서 검사하고 기록 (`docs/agent.md` §36) | 계약을 정책 문서가 아니라 코드와 기록으로 지킨다. 모델 교체도 이 한 곳에서 |
| Claude | 사용자 본인 구독. 수정하지 않은 Claude Code 바이너리에 사용자가 직접 로그인. API 키 경로를 보험으로 함께 둔다 | §4 |
| 로컬 모델 (후보) | llama.cpp `llama-server` 사이드카, 맥은 MLX 선택지. 초벌·용어 검사·QE는 로컬, 검토·뉘앙스는 Claude | §5 |
| 출처 기록 | 문단마다 AI가 무엇을 했고 사람이 무엇을 승인했는지 | 한국 AI 기본법, 출판계 3단계 표시, Authors Guild 조항 — §6 |

## 2. 셸: Electron. 한국어 입력이 아니라 Agent SDK와 선례로 고른다

- **Agent SDK는 TypeScript와 Python뿐이다.** Electron에는 Node가 들어 있어 SDK가 그대로 돈다. Tauri, Swift, Rust 네이티브는 Node 사이드카를 따로 넣고 그 수명과 서명을 직접 맡아야 한다. 다른 언어에서 `claude -p --output-format stream-json`을 직접 띄우는 길도 있지만, 문서가 `--bare`를 `-p`의 기본값으로 바꾼다고 예고했고 bare 모드는 키체인의 구독 로그인을 읽지 않는다. 구독 방식과 부딪힌다(§4).
- **선례**: Octave가 같은 구성으로 배포 중이다. Electron + Agent SDK 0.3.x에, 사용자 구독 로그인, 받아 온 Claude Code 바이너리의 Anthropic 서명 검증, electron-updater를 쓴다. Claude 데스크톱 앱도 Electron이다(이 맥의 앱 번들에서 확인, 2026-11-26).
- **WebKit과 한국어 (바로잡음)**: 맥 WebKit은 한국어 시스템 입력기에서 `compositionstart/update/end`를 보내지 않는다(WebKit 274700, 2024-05부터 열려 있음). Apple의 답은 "입력기가 인라인 입력 세션을 만들지 않으니 예상된 동작"이다. 대신 글자를 `insertText`로 넣고, 같은 자리를 `insertReplacementText`로 고쳐 쓴다. 깨지는 것은 조합 이벤트에 기대는 코드다. "안녕하세요"가 "ㅇ, ㄴ, ㅎ, 세, 요"로 들어온 것은 xterm.js의 버그다(xterm.js #6284, 2026-11-02, Safari 26.2와 Tauri 2). 2026-11-26 Safari 26에서 지금 에디터를 두벌식으로 시험했다. 입력, 조합 중 Enter·Backspace, 자동 저장, 표시(댓글·용어) 안의 입력, Claude 입력창과 댓글의 Enter 전송, ⌘Z가 모두 정상이었다. 남은 위험은 `isComposing`에 기대는 Enter 전송 두 곳(`app/src/features/agent/Composer.tsx`, `app/src/features/notes/CommentThread.tsx`)이다. WebKit에서는 이 값이 늘 false다. 한자 변환과 긴 목록은 시험하지 않았다.
- **Tauri**: 한국어 입력은 막는 이유가 아니다. 고르지 않는 이유는 Node 사이드카다. 단일 바이너리로 컴파일하고, 앱이 꺼질 때 정리하고, 따로 서명해야 한다. 그리고 같은 SDK를 사이드카로 쓰는 성숙한 선례가 없다. 이점은 크기다. 같은 앱으로 잰 번들은 Tauri 57MB, Electron 323MB다. 대기 메모리는 109MB와 128MB로 비슷하다. 화면은 같은 React라 나중에 옮기는 비용이 크지 않다.
- **Tauri + Bun**: Bun으로 서버를 단일 바이너리로 묶어 사이드카로 넣기 쉽다(Bun 1.4 `--no-orphans`). Anthropic이 2025-12에 Bun을 인수했고, Claude Code가 Bun 실행 파일로 배포된다(이 맥의 Claude Code 2.1.322 실행 파일에서 Bun v1.4.4 확인). 그러나 이 맥의 Bun 1.3.13은 `node:sqlite`를 불러오지 못한다(직접 확인, 2026-11-15). Bun 1.4는 Zig→Rust로 다시 쓴 지 석 달이다.
- **Swift 네이티브**: 한국어 편집은 `NSTextView`가 가장 좋다. 그러나 언어가 둘(Swift + Node 사이드카)이 되고, 화면과 에디터를 전부 새로 짓는다. 맥 API가 필요한 기능(Vision OCR 등)은 Electron에 Swift 모듈로 붙인다.
- **Rust 네이티브(gpui 등)**: 한국어 입력이 검증된 리치 텍스트 편집기가 없다. gpui-component 포크에서 Core Text의 한국어 run 경계 패닉을 겪었다.
- **Electron 45**(2026-10-21): Chromium 156, Node 24.22, `utilityProcess`로 Node 프로세스, macOS 델타 업데이트. 비용은 약 8주마다 메이저가 나오고 최근 3개만 지원한다는 것이다. 클라우드 서버가 없으니 Node의 기준은 Electron 안의 Node 하나다.

## 3. 데이터와 가져오기: op log는 그대로, PDF 가져오기는 Rust 부품으로

- 쓰는 쪽은 번역가와 Claude 둘이다. 앱의 Node 프로세스 하나가 op log의 순서를 정한다. 지금 구조 그대로다. 기기 사이의 동기화가 없으니 CRDT나 외부 동기 엔진은 필요 없다(다시 볼 조건은 §9).
- **Rust의 원칙**: 앱 로직은 TypeScript로 짠다. Rust는 입력과 출력이 분명하고 따로 검증할 수 있는 부품에만 쓴다. 앱 전체를 Rust로 하지 않는다(§9).
- **첫 Rust 부품은 PDF 가져오기 엔진이다.** 지금 Python 파이프라인(`pipeline/`)이 쓰는 PyMuPDF는 AGPL과 상용의 이중 라이선스다. 소스를 공개하지 않고 배포하려면 상용 라이선스가 필요하다. 또 지금 파이프라인은 한 책에 맞춘 상수로 되어 있어(러닝헤드 형식, 행간, Notes 섹션 모양) 다른 책에 쓰려면 일반화해야 한다.
- **경계**: 입력은 PDF 경로, 출력은 장, 문단(종류), 미주, 원서 쪽 번호, 좌표 상자의 JSON이다. Electron에는 napi 모듈이나 별도 실행 파일로 붙인다. 쪽 이미지 렌더링을 엔진에 넣을지는 엔진을 설계할 때 정한다.
- **검증**: 지금 책을 정답으로 쓴다. 엔진을 짜기 전에, 기존 파이프라인이 만든 장·문단·미주·쪽과 같은 결과가 나오는지 보는 회귀 테스트를 먼저 만든다.
- PDF 라이브러리는 라이선스를 보고 고른다(pdfium-render 등, 미확인). 텍스트 레이어가 없는 스캔본의 OCR은 맥 API(Vision `RecognizeDocumentsRequest`)라 Swift 모듈 후보다. 가져올 형식의 범위(EPUB 등)는 아직 정하지 않았다(`.context/research/3-formats.md`).
- 다른 Rust 부품은 실제로 필요가 생길 때만 더한다.

## 4. AI 계층: 모델 포트, MCP 도구, 출구

- **모델 포트**: 앱의 작업 단위(문단 초벌, 검토, 도구를 쓰는 대화)로 좁은 인터페이스를 두고, 어댑터는 Claude Agent SDK · Messages API · OpenAI 호환 로컬 서버.
- **작업마다 가장 단순한 형태**: 대화·수정은 Agent SDK(훅·권한·세션을 이미 쓴다). 책 전체 초벌 같은 대량 작업은 에이전트가 아니라 Messages API 파이프라인. 이 맥의 Agent SDK 기록 34세션을 정가로 환산하면 문단당 약 $0.08~0.42였고, 고정 프롬프트를 캐시하는 초벌+검토 파이프라인은 300쪽(약 1,500문단) 책 한 권에 Opus 5.5 약 $62, Sonnet 5.5 약 $31로 추정된다. 로컬 모델에는 에이전트 루프 대신 문단 하나를 JSON 스키마로 받는 호출.
- **Agent SDK를 로컬 모델에 잇지 않는다**: `ANTHROPIC_BASE_URL`만 바꾸면 돌아가지만 Anthropic은 Claude Code를 Claude 아닌 모델로 보내는 것을 지원하지 않는다. Ollama의 Anthropic 호환 API에는 프롬프트 캐시와 `tool_choice`가 없다.
- **Managed Agents는 맞지 않는다**: 우리 도구는 DB 작업이라 샌드박스가 필요 없고, 베타이며 ZDR 대상이 아니다.
- **인증: 사용자 본인 구독, Octave와 같은 방식**: 앱은 수정하지 않은 Claude Code 바이너리를 쓴다. SDK의 플랫폼 패키지에 든 것을 쓰고, 없으면 npm에서 받아 `codesign`으로 Anthropic 서명(TeamIdentifier `Q6L2SF6YDW`)을 확인한다. 로그인 상태는 `claude auth status`로 읽고, 로그인은 사용자가 `claude auth login`으로 직접 한다. 앱은 토큰을 읽지도 저장하지도 않는다.
- **약관 (배포 전에 반드시)**: Claude Code 법률·컴플라이언스 페이지(2026-11-26 읽음)에는 허용과 금지가 함께 있다. 허용: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription"(2026-08 말 추가). 금지: "offer Claude.ai login into their own applications", "collect, store, or intermediate Claude.ai credentials or session tokens". Agent SDK 개요에는 "Unless previously approved … including agents built on the Claude Agent SDK"가 아직 남아 있어 회색지대다. 그래서 배포 전에 Anthropic에 서면으로 확인한다(§7의 1). 정책이 바뀌면 바로 옮길 수 있게 API 키 경로를 함께 둔다. 모델 포트가 있으니 어댑터 하나다. 이름은 "Claude Code" 불가, "… Powered by Claude" 가능.
- **`--bare` 예고**: Headless 문서는 `--bare`가 `-p`의 기본값이 된다고 예고한다. bare 모드는 키체인의 OAuth를 읽지 않는다. Agent SDK가 이 영향을 받는지는 미확인이다. SDK를 올릴 때마다 구독 로그인으로 실제 시험한다.
- **API 키 경로의 데이터 보관**: API 데이터는 학습에 쓰지 않는다. ZDR은 조직 단위로 영업에 요청한다. Messages API·프롬프트 캐시·구조화 출력은 ZDR 대상, **Batch API(29일 보관)·Files API·MCP 커넥터는 아니다**. Fable·Mythos 계열(Covered Models)은 30일 보관이 필수라 ZDR로 쓸 수 없다. 1차 API의 추론 지역은 `global`·`us`뿐이다 — 한국·EU 안에서만 처리하라는 요구에는 로컬 모델이나 Bedrock·Vertex 지역 엔드포인트로 답한다.

## 5. 로컬 모델: 초벌과 검사는 로컬, 검토와 뉘앙스는 클라우드

| WMT26 영→한 사람 평가 (0~100, 문서 단위, 문학 도메인 없음) | 점수 |
|---|---|
| Gemini 3.1 Pro (클라우드) | 83.5 |
| Lumen (Qwen 14B+4B, 번역 특화 튜닝) | 82.5 |
| GPT 5.5 (클라우드) | 80.9 |
| Gemma 4 31B (오픈 범용) | 76.2 |
| Qingqiu-MT-9B (Qwen 3.5 9B 튜닝) | 69.3 |
| Google Translate | 63.5 |
| Gemma 4 4B | 60.9 |
| Qwen 3.5 9B (튜닝 전) | 18.9 |

- 최고 클라우드와 최고 오픈 범용의 차이는 약 7점. 번역 특화 튜닝이 차이를 거의 메운다(18.9 → 69.3). Claude 단독 점수는 없다. 문학은 WMT25뿐: 사람 −2.4, Hunyuan 7B −3.0, Claude 4 −3.1, Gemini 2.5 Pro −3.5(0에 가까울수록 좋음).
- 후보: **Hy-MT2-7B**(Tencent, 2026-05, Apache 2.0 — 7B의 LICENSE 기준, 용어·맥락 템플릿, 8K 맥락), **Gemma 4**(2026-04 Apache 2.0). TranslateGemma는 입력 2K·고정 템플릿이라 용어집과 맥락을 넣기 어렵다. Cohere 번역 모델은 비상업. 한국산 중 상업 라이선스가 넉넉한 것은 수백 B라 맥에 안 들어간다.
- 등급: 16GB 맥은 4~8B(Hy-MT2-7B, Gemma 4 4B급), 32GB 이상은 Gemma 4 26B-A4B·31B. 7B Q4 생성 속도는 기본 M4 24 tok/s, M5 Pro 66, M5 Max 120(메모리 대역폭을 따른다).
- 런타임: llama.cpp `llama-server`(OpenAI·Anthropic 호환 API, 도구 호출, JSON 스키마, MIT, 빌드 번호 고정·서명·공증). 맥에서 느리면 같은 API 뒤에 MLX. 사용자의 Ollama·LM Studio도 받되 Ollama `:cloud` 모델은 막는다(주소는 localhost인데 밖에서 돈다).
- 보조로만: Apple Foundation Models(세션당 4,096토큰, 한국어는 대략 한 글자 한 토큰 — 긴 문단 하나), 브라우저 WebGPU(네이티브의 약 71~80%), Chrome Translator API(데스크톱 Chrome만).
- 품질을 올리는 첫 수단은 미세조정이 아니라 승인된 문단쌍·용어집 검색(번역 메모리). 낮은 품질 문단 골라내기는 MetricX-24(Apache 2.0). CometKiwi는 비상업.
- 로컬 모델의 가치는 비용보다 **규정 대응**이다: Anthropic 1차 API에 한국·EU 추론 지역이 없고, 출판 계약은 점점 "어디서 처리되는가"를 묻는다.

## 6. 계약·법이 요구하는 것, 그리고 차별점

- 계약의 흐름은 "AI 금지"가 아니라 "소비자용 AI 금지, 학습 금지, 사용 공개"다. Authors Guild(2026-04-29) 조항: 원고를 소비자용 AI에 올리지 않고 제3자 학습에 쓰이지 않게 한다. AI 번역은 저자 동의가 필요하지만, 사람 번역가가 실질적으로 만들고 모든 단어를 승인하면 AI를 보조로 쓸 수 있다.
- 한국: 출판 13개 단체의 "AI 사용 원칙"(2026-09-29)은 인간 저작물 / AI 보조 / AI 생성의 3단계 표시를 권한다(구속력 없음). 앞서 "책도둑" 앱이 AI 번역 사실을 숨겨 환불하고 문을 닫았다 — 문제는 사용이 아니라 미공개였다.
- 한국 AI 기본법(2026-01-22 시행): 외부 LLM을 쓰는 제품은 "AI 이용사업자"일 가능성이 있다(배포하는 데스크톱 앱이 해당하는지는 §7의 8). 화면의 사전 고지, **내려받는 파일에는 헤더·메타데이터로 AI 생성 표시**. 개인정보보호법: 실명 인물이 나오는 문단을 미국 API로 보내는 것은 국외 이전 — 위탁 근거와 처리방침 공개. EU AI Act 제50조 투명성 의무는 2026-08-02부터.
- 경쟁: Trados Studio 2026은 이미 Ollama·LM Studio 로컬 모델을 붙인다 — "로컬 모델 지원"은 차별점이 아니다. 클라우드 TMS는 "학습 안 함"과 BYOK, 기업 MT는 온프레미스, 책 쪽 AI 번역(Kindle Translate, GlobeScribe, Spines)은 번역가를 대체한다.
- **차별점은 모델이 아니라 기록이다**: 번역가가 쓰는 책 전체 맥락의 편집기, AI는 조수·검토자, 원문 파일이 기기를 떠나지 않음을 코드로 보장, 그리고 문단마다 "AI 초벌 / 제안 / 검토 / 없음"과 사람의 승인을 기록해 "AI 사용 내역서"로 내보내기. 마지막 하나가 한국 3단계 표시, Authors Guild 공개 조항, AI 기본법의 내보내기 표시를 함께 푼다. 재료는 이미 있다: `ops`에 누가(번역가/Claude, `tool_use_id`) 무엇을 바꿨는지가 남고, §36의 출구 기록이 무엇이 나갔는지를 더한다.

## 7. 먼저 확인할 것

| # | 확인할 것 | 왜 | 어떻게 |
|---|---|---|---|
| 1 | 배포하는 앱에서 사용자 본인 구독 로그인(§4의 Octave 방식)이 허용되는가 | 법률 페이지는 허용 문장을 더했지만 Agent SDK 개요의 "사전 승인" 문구가 남아 있다 | Anthropic에 서면 질의 |
| 2 | ~~TipTap 에디터의 한국어 입력이 WebKit에서 정상인가~~ **완료(2026-11-26)** | Tauri 재검토 | Safari 26 + 두벌식으로 정상(§2). 한자 변환과 긴 목록은 남음 |
| 3 | 기본 보관 기간과 ZDR 조건 (API 키 경로) | 문서끼리 말이 다르다(기본 보관 없음 / 30일 안에 삭제) | 계정팀 |
| 4 | 출판 계약 해석 | AI 초벌이 허용되는가 | 출판사·변호사. 원문 PDF와 쪽 이미지는 기기에만 |
| 5 | 로컬 모델의 실제 영→한 품질과 라이선스 | Hy-MT2·TranslateGemma의 사람 평가가 없다 | 우리 책 50~100문단으로 Claude와 블라인드 비교, 크기별 LICENSE |
| 6 | 번역가들의 맥 사양 | 로컬 모델 등급 | 초기 사용자 설문(칩, RAM) |
| 7 | 한국어의 Claude 토큰 수 | 책 한 권 비용 추정 | 실제 문단으로 `count_tokens` |
| 8 | AI 기본법의 "생성 결과물" 범위, 배포 앱의 해당 여부 | 내보내기 표시 범위 | 한국 변호사 |
| 9 | PyMuPDF(AGPL)를 배포 빌드에서 빼기 | 소스를 공개하지 않고 배포하면 라이선스 위반 | Rust 엔진(§3)으로 바꾸기 전까지 배포 빌드에 넣지 않는다 |
| 10 | Electron 안의 Node 24에서 `node:sqlite`가 도는가 | 앱 로직이 쓴다 | 1단계 첫 작업에서 시험 |

## 8. 로드맵

| 단계 | 할 일 | 끝났다는 기준 |
|---|---|---|
| 0. 지금 (개발 중, 1인) | AI 출구(`docs/agent.md` §36). Anthropic 서면 질의 | 책 내용이 나가는 모든 길이 기록되고, 이미지·문서 블록은 나갈 길이 없음을 테스트가 단언한다. 기존 테스트 통과 |
| 1. Electron 앱 | Electron 셸에 지금 화면과 앱 로직(`utilityProcess`)을 싣는다. 데이터를 개발 폴더 밖 `~/.fitz/`로(책 DB, 쪽 이미지, 매일 백업 14개). 구독 로그인 화면(Octave 방식)과 API 키 대안. Claude Code 바이너리를 받아 서명 확인. 서명·공증, 자동 업데이트(electron-updater). 업데이트 때 백업 → 마이그레이션 → 확인 → 실패면 되돌림. 21:00 Session은 앱이 꺼져 있었으면 다음 실행 때 한다. 계획 메모: `.context/local-app-plan.md`(웹 기준으로 쓰여 있어 고쳐 써야 한다) | `.dmg`로 설치해 터미널 없이 쓴다. 다른 맥에서 처음 설치 → 로그인 → 책 열기가 된다. 업데이트가 실패해도 책이 남는다. 기존 테스트 통과 |
| 2. 가져오기 | Rust PDF 엔진(§3). 책 목록과 새 책 만들기. 가져오기 → 구조 미리보기에서 틀린 곳 고치기 → Review 검수. 다른 형식(EPUB 등)은 미정 | 지금 책으로 기존 파이프라인과 같은 결과(회귀 테스트). Python 없이 앱 안에서 새 책을 만든다. 배포 빌드에 AGPL 코드가 없다 |
| 3. 로컬 모델 (후보) | Electron에 llama-server(빌드 고정, 서명·공증), 첫 실행 때 모델 내려받기(SHA-256, 이어받기), RAM 등급별 모델, 책 정책 `local_only`, 초벌·용어 검사·QE, 번역 메모리 검색 | `local_only` 책에서 외부로 나간 요청 0건, 16GB 맥에서 쓸 만한 속도, 블라인드 비교로 등급별 품질 확인 |

## 9. 하지 않는 것과 다시 볼 조건

| 하지 않는 것 | 다시 볼 조건 |
|---|---|
| SaaS·웹앱(계정·팀·결제, 클라우드 서버, 기기 사이 동기화) | 여러 사람이 한 책을 함께 쓰거나 웹 입구가 필요해질 때. 출발점은 처음 판(4db2dd4)의 §1·§3·§8 2단계다: 서버 권위 op log에 책별 일련번호, 계정은 서울 리전 Postgres(Supabase `ap-northeast-2`), 상용 API 키 + ZDR, 한 조직 키로 Agent SDK를 호스팅해도 되는지 서면 확인 |
| Tauri | 앱 크기가 문제가 되거나, Agent SDK를 사이드카로 쓰는 성숙한 선례가 생길 때. 한국어 입력은 막는 이유가 아니다(§2) |
| Swift 네이티브 앱 | 맥 앱다운 느낌이 제품의 핵심 가치가 될 때. 그 전에는 맥 API가 필요한 기능만 Swift 모듈로 |
| 앱 전체를 Rust로 (gpui 등) | 한국어 입력이 검증된 Rust 리치 텍스트 편집기와 Rust용 Agent SDK가 생길 때 |
| Bun 서버 | Bun이 `node:sqlite`를 지원하고 서버를 앱 안에 단일 바이너리로 넣어야 할 때 |
| 책 전체를 CRDT 문서 하나로 | — (같은 문단을 실시간으로 함께 고칠 필요가 생기면 문단별 Yjs + Hocuspocus. ProseMirror 연동 안정판은 y-prosemirror뿐) |
| Zero, Electric Cloud | 원고를 Postgres로 옮기면 PowerSync를 본다 |
| Managed Agents | 샌드박스가 필요한 도구가 생길 때 |
| Agent SDK를 로컬 모델에 잇기 | Anthropic이 지원할 때 |
