# fitz의 구조 방향 — 혼자 쓰는 앱에서 SaaS, 그리고 로컬 모델까지 (2026-11-15)

지금 제품에 얽매이지 않고, 번역 SaaS와 나중의 로컬 모델까지 놓고 다시 설계하면 어떤 구조가 맞는가. 그 결론과 근거, 다시 볼 조건을 적는다. 아직 구현 전의 방향이다. 조사 원문(출처 링크 전부)은 `.context/reports/번역 SaaS 로컬 모델 아키텍처.md`에 있다(커밋하지 않음). 이 문서에는 결정에 쓰인 사실만 옮긴다.

## 1. 결론

서버 하나, 화면 둘, AI 출구 하나.

| 계층 | 선택 | 이유 |
|---|---|---|
| 화면 | React + TipTap 번들 한 벌 | 웹과 데스크톱이 같은 코드 |
| 셸 | 웹앱 + Electron 데스크톱 앱 | Chromium이라 한국어 입력이 어디서나 같다. 지금 Node 서버를 그대로 품는다 |
| 서버 | Node 26 LTS 한 벌 — 클라우드와 번역가의 맥에서 같은 코드 | `node:sqlite` 내장, 자식 프로세스(Claude Code)와 WebSocket의 기준 구현 |
| 원고 데이터 | 서버가 순서를 정하는 op log + 문단별 version, 책마다 SQLite 파일 하나 | 작성자별 되돌리기, AI 쓰기 검증, 책 단위 격리(지우기·지역 지정이 쉽다) — 지금 구조 그대로 |
| 동기화 | op log에 책별 일련번호, "N번 이후 op"를 WebSocket으로. 기기에는 로컬 SQLite와 대기 큐 | Figma·Linear와 같은 서버 권위 방식. 충돌은 문단 단위로 번역가가 고른다 |
| 계정·팀·결제 (SaaS) | Postgres, 서울 리전(Supabase `ap-northeast-2`) | 한국 리전이 있는 관리형 Postgres |
| 원문 PDF·쪽 이미지 | 기기에만. OCR도 기기에서 | 출판 계약 |
| AI 도구 | MCP 도구 서버 하나 | Claude와 로컬 모델이 같은 도구, 같은 규칙(`expectVersion`, 용어 검사)을 쓴다 |
| AI 출구 | 책 내용이 모델로 나가는 모든 길을 한 곳에서 검사하고 기록 (`docs/agent.md` §36) | 계약을 정책 문서가 아니라 코드와 기록으로 지킨다. 모델 교체도 이 한 곳에서 |
| 클라우드 모델 | Claude — SaaS에서는 상용 API 키 + ZDR | 학습 안 함, 보관 없음 |
| 로컬 모델 (나중) | llama.cpp `llama-server` 사이드카, 맥은 MLX 선택지. 초벌·용어 검사·QE는 로컬, 검토·뉘앙스는 Claude | §5 |
| 출처 기록 | 문단마다 AI가 무엇을 했고 사람이 무엇을 승인했는지 | 한국 AI 기본법, 출판계 3단계 표시, Authors Guild 조항 — §6 |

## 2. 셸: 웹 + Electron. Tauri는 한국어 입력 때문에 고르지 않는다

- **맥의 WebKit은 시스템 한국어 입력기에서 `compositionstart/update/end`를 보내지 않는다.** Apple은 "예상된 동작"이라 답했고 버그는 2024년 5월부터 열려 있다(WebKit 274700). 2026-11-02에 Tauri 2의 WKWebView에서 재현됐다("안녕하세요" → "ㅇ, ㄴ, ㅎ, 세, 요"). Chromium은 조합 이벤트를 보낸다. Linux의 Tauri는 인라인 조합 표시를 꺼 둔다(wry PR #1724 미병합).
- 위험은 ProseMirror 자체보다 우리 코드다: 조합 중 자동 저장, 데코레이션 갱신, Enter 처리. Safari 26이 Tauri 맥 빌드와 같은 엔진이므로 Safari에서 두벌식으로 시험하면 된다(§7의 2).
- 크기는 결정 요인이 아니다. 같은 앱으로 잰 번들 Tauri 57MB / Electron 323MB, 대기 메모리 109MB / 128MB. 로컬 모델 가중치는 수 GB다.
- **Tauri + Bun**: Bun으로 서버를 단일 바이너리로 묶어 사이드카로 넣기 쉽고(Bun 1.4 `--no-orphans`), Anthropic이 2025-12에 Bun을 인수했다. 그러나 한국어 입력 문제는 WebKit에서 오고 Bun은 그걸 바꾸지 못한다. 이 맥의 Bun 1.3.13은 `node:sqlite`를 불러오지 못한다(직접 확인, 2026-11-15). Bun 1.4는 Zig→Rust로 다시 쓴 지 석 달이다.
- **Electron 45**(2026-10-21): Chromium 156, Node 24.22, `utilityProcess`로 Node 프로세스, macOS 델타 업데이트. Claude, Codex, Cursor, VS Code, Slack, Notion, Figma가 Electron이다. 비용: 약 8주마다 메이저, 최근 3개만 지원. Electron 안의 Node가 24이므로 서버는 Node 24와 26 양쪽에서 테스트한다.
- **웹만으로는 부족하다**: 브라우저는 프로세스를 띄울 수 없어 Claude Code나 llama.cpp를 기기에서 못 돌린다. Chrome 142부터 공개 사이트가 localhost를 부르면 권한 창이 뜬다. Safari는 7일간 방문이 없으면 저장소를 지울 수 있다. 그래서 웹은 SaaS의 가벼운 입구, 원문 보관·오프라인·로컬 모델은 데스크톱이 맡는다.
- 혼자 쓰는 동안에는 Electron 없이도 된다: 서버가 화면까지 주고 맥이 켜질 때 자동으로 뜨게 하면(§8의 1단계), Chrome의 "앱으로 설치"가 창과 Dock 아이콘을 준다.

## 3. 데이터: 서버가 순서를 정한다. CRDT·외부 동기 엔진은 지금 쓰지 않는다

- 서버 권위 op log가 정석이다. Figma는 "진짜 CRDT를 쓰지 않는다, 서버가 중앙 권위라서 단순하다"고 썼다. Jazz는 2026년 v2에서 CRDT를 버리고 신뢰 서버 모델로 돌아섰다. 번역가는 같은 문장이 글자 단위로 자동 병합되기보다, 충돌이 문단 단위로 드러나 직접 고르기를 원한다.
- CRDT가 필요해지면(같은 문단을 실시간으로 함께 고치는 요구) 후보는 Yjs뿐이다: ProseMirror 연동이 안정판인 것은 y-prosemirror(1.3.7)뿐이고, UndoManager가 origin별 되돌리기를 지원한다. 책 한 권을 문서 하나로 만들지 않고 문단마다 작은 문서, 자체 호스팅 Hocuspocus. Yjs 14(작성자 표시·변경 추적)는 아직 RC/베타.
- 외부 동기 엔진은 2025~2026년에 흔들렸다: Electric은 Databricks에 합류하고 Electric Cloud는 닫는 중, Replicache는 유지보수 모드, Zero는 오프라인 쓰기를 거부한다. 원고를 Postgres로 옮기게 되면 그때 PowerSync(쓰기는 우리 API를 지난다)를 본다.
- 서버 런타임은 Node: **Node 26이 2026-10-28 LTS가 됐다.** `node:sqlite`는 플래그 없는 릴리스 후보. 이 맥(26.9)은 26.13.x로 올린다.

## 4. AI 계층: 모델 포트, MCP 도구, 출구

- **모델 포트**: 앱의 작업 단위(문단 초벌, 검토, 도구를 쓰는 대화)로 좁은 인터페이스를 두고, 어댑터는 Claude Agent SDK · Messages API · OpenAI 호환 로컬 서버.
- **작업마다 가장 단순한 형태**: 대화·수정은 Agent SDK(훅·권한·세션을 이미 쓴다). 책 전체 초벌 같은 대량 작업은 에이전트가 아니라 Messages API 파이프라인. 이 맥의 Agent SDK 기록 34세션을 정가로 환산하면 문단당 약 $0.08~0.42였고, 고정 프롬프트를 캐시하는 초벌+검토 파이프라인은 300쪽(약 1,500문단) 책 한 권에 Opus 5.5 약 $62, Sonnet 5.5 약 $31로 추정된다. 로컬 모델에는 에이전트 루프 대신 문단 하나를 JSON 스키마로 받는 호출.
- **Agent SDK를 로컬 모델에 잇지 않는다**: `ANTHROPIC_BASE_URL`만 바꾸면 돌아가지만 Anthropic은 Claude Code를 Claude 아닌 모델로 보내는 것을 지원하지 않는다. Ollama의 Anthropic 호환 API에는 프롬프트 캐시와 `tool_choice`가 없다.
- **Managed Agents는 맞지 않는다**: 우리 도구는 DB 작업이라 샌드박스가 필요 없고, 베타이며 ZDR 대상이 아니다.
- **약관 (SaaS 전에 반드시)**: 서드파티 제품은 사전 승인 없이 claude.ai 로그인·구독 한도를 쓸 수 없고 API 키를 써야 한다. 이름은 "Claude Code" 불가, "… Powered by Claude" 가능. 그런데 법무 문서의 "제품에 Claude Code를 넣을 수 있나" 항목은 호스팅 인프라에서 Claude Code를 돌릴 때 "각 최종 사용자가 자기 키나 구독으로 인증해야 하고 사용료를 대신 내거나 중개할 수 없다"고 적는다. 한 조직 키로 사용자 사용량을 내는 구조가 여기 걸리는지 서면으로 묻는다. 안 되면 Claude 경로를 Messages API(Tool Runner)로 — 모델 포트가 있으면 어댑터 하나다.
- **데이터 보관**: API 데이터는 학습에 쓰지 않는다. ZDR은 조직 단위로 영업에 요청한다. Messages API·프롬프트 캐시·구조화 출력은 ZDR 대상, **Batch API(29일 보관)·Files API·MCP 커넥터는 아니다**. Fable·Mythos 계열(Covered Models)은 30일 보관이 필수라 ZDR로 쓸 수 없다. 1차 API의 추론 지역은 `global`·`us`뿐이다 — 한국·EU 안에서만 처리하라는 요구에는 로컬 모델이나 Bedrock·Vertex 지역 엔드포인트로 답한다.

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
- 한국 AI 기본법(2026-01-22 시행): 외부 LLM을 쓰는 SaaS는 "AI 이용사업자"일 가능성이 높다. 화면의 사전 고지, **내려받는 파일에는 헤더·메타데이터로 AI 생성 표시**. 개인정보보호법: 실명 인물이 나오는 문단을 미국 API로 보내는 것은 국외 이전 — 위탁 근거와 처리방침 공개. EU AI Act 제50조 투명성 의무는 2026-08-02부터.
- 경쟁: Trados Studio 2026은 이미 Ollama·LM Studio 로컬 모델을 붙인다 — "로컬 모델 지원"은 차별점이 아니다. 클라우드 TMS는 "학습 안 함"과 BYOK, 기업 MT는 온프레미스, 책 쪽 AI 번역(Kindle Translate, GlobeScribe, Spines)은 번역가를 대체한다.
- **차별점은 모델이 아니라 기록이다**: 번역가가 쓰는 책 전체 맥락의 편집기, AI는 조수·검토자, 원문 파일이 기기를 떠나지 않음을 코드로 보장, 그리고 문단마다 "AI 초벌 / 제안 / 검토 / 없음"과 사람의 승인을 기록해 "AI 사용 내역서"로 내보내기. 마지막 하나가 한국 3단계 표시, Authors Guild 공개 조항, AI 기본법의 내보내기 표시를 함께 푼다. 재료는 이미 있다: `ops`에 누가(번역가/Claude, `tool_use_id`) 무엇을 바꿨는지가 남고, §36의 출구 기록이 무엇이 나갔는지를 더한다.

## 7. 먼저 확인할 것

| # | 확인할 것 | 왜 | 어떻게 |
|---|---|---|---|
| 1 | 한 조직 키로 호스팅 서버에서 Agent SDK를 돌려도 되는가 | SaaS의 기본 구조가 걸린다 | Anthropic 영업에 서면 질의 |
| 2 | TipTap 에디터의 한국어 입력이 WebKit에서 정상인가 | Safari 웹 사용자, Tauri 재검토 | Safari 26 + 두벌식: 조합 중 Enter·Backspace, 표시(댓글·용어) 안 입력, 자동 저장 |
| 3 | 기본 보관 기간과 ZDR 조건 | 문서끼리 말이 다르다(기본 보관 없음 / 30일 안에 삭제) | 계정팀 |
| 4 | 출판 계약 해석 | 쪽 이미지를 (AI가 아닌) 우리 서버에 둬도 되는가, AI 초벌이 허용되는가 | 출판사·변호사. 답이 나올 때까지 이미지는 기기에만 |
| 5 | 로컬 모델의 실제 영→한 품질과 라이선스 | Hy-MT2·TranslateGemma의 사람 평가가 없다 | 우리 책 50~100문단으로 Claude와 블라인드 비교, 크기별 LICENSE |
| 6 | 번역가들의 맥 사양 | 로컬 모델 등급 | 초기 사용자 설문(칩, RAM) |
| 7 | 한국어의 Claude 토큰 수 | 책 한 권 비용 추정 | 실제 문단으로 `count_tokens` |
| 8 | AI 기본법의 "생성 결과물" 범위 | 내보내기 표시 범위 | 한국 변호사 |

## 8. 로드맵

| 단계 | 할 일 | 끝났다는 기준 |
|---|---|---|
| 0. 지금 (개발 중, 1인) | AI 출구(`docs/agent.md` §36). Node 26.13 LTS. Safari 한국어 입력 시험. Anthropic 약관 질의 | 책 내용이 나가는 모든 길이 기록되고, 이미지·문서 블록은 나갈 길이 없음을 테스트가 단언한다. 기존 테스트 통과 |
| 1. 혼자 쓰는 앱 | 데이터를 개발 폴더 밖 `~/.fitz/`로(책 DB, 쪽 이미지, 매일 백업 14개). 서버가 빌드된 화면도 준다. 맥이 켜지면 자동 실행(launchd), 완성본만 교체하는 업데이트(빌드·테스트 → 백업 → 마이그레이션 → 교체 → 확인 → 실패면 되돌림). 창과 아이콘은 Chrome "앱으로 설치" 또는 Electron. 계획 메모: `.context/local-app-plan.md` | 터미널 없이 `localhost:4800`, 21:00 Session이 빠지지 않는다, 작업 폴더를 지워도 번역이 남는다 |
| 2. SaaS | 서울 리전 클라우드 Node 서버, 테넌트와 권한, 계정은 Postgres·원고는 책별 SQLite, 웹앱 + Electron(원문 보관·오프라인 대기 큐), 상용 API 키 + ZDR(Covered Models·Batch·Files 막음), 대량 초벌 파이프라인 분리, AI 고지·내보내기 메타데이터·처리방침·AI 사용 내역서 | 다른 테넌트 책 접근 테스트가 실패, 오프라인 편집이 재연결 때 반영되고 충돌은 문단 단위, 모든 호출에 기록, Node 24·26 양쪽 통과 |
| 3. 로컬 모델 | Electron에 llama-server(빌드 고정, 서명·공증), 첫 실행 때 모델 내려받기(SHA-256, 이어받기), RAM 등급별 모델, 책 정책 `local_only`, 초벌·용어 검사·QE, 번역 메모리 검색 | `local_only` 책에서 외부로 나간 요청 0건, 16GB 맥에서 쓸 만한 속도, 블라인드 비교로 등급별 품질 확인 |

## 9. 하지 않는 것과 다시 볼 조건

| 하지 않는 것 | 다시 볼 조건 |
|---|---|
| Tauri | Safari 한국어 입력 시험(§7의 2)을 통과하거나 Tauri 3의 Chromium 런타임(CEF)이 안정될 때 |
| Bun 서버 | Bun이 `node:sqlite`를 지원하고 서버를 앱 안에 단일 바이너리로 넣어야 할 때 |
| 책 전체를 CRDT 문서 하나로 | — (필요하면 문단별 Yjs + Hocuspocus) |
| Zero, Electric Cloud | 원고를 Postgres로 옮기면 PowerSync를 본다 |
| Managed Agents | 샌드박스가 필요한 도구가 생길 때 |
| Agent SDK를 로컬 모델에 잇기 | Anthropic이 지원할 때 |
