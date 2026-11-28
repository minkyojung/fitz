# fitz

영어 책을 한국어로 번역하는 맥 전용 1인용 데스크톱 앱. Claude가 조수로 붙는다. 이 브랜치는 프로토타입의 번역 데이터를 그대로 이어받는 제품판이다.

## 시작하기

```sh
pnpm install          # 루트와 app/ 을 함께 설치한다
scripts/dev-data.sh   # 개발용 사본을 dev-data/ 에 만든다 (원본은 읽기만 한다)
pnpm exec playwright install chromium   # 브라우저 테스트용 Chromium (한 번만)
pnpm check            # 타입 검사, 린트, 화면 빌드, 테스트 (일반 Node, Electron의 Node, 브라우저)
pnpm server           # 서버만 띄운다. 출력된 주소를 브라우저로 연다 (화면은 app/ 에서 pnpm build 한 것)
```

## 폴더

| 폴더 | 내용 |
|---|---|
| `server/` | 앱 로직. 책 DB를 읽는다 |
| `shared/` | 화면과 서버가 함께 쓰는 메시지 규약 |
| `app/` | 화면 (React + Vite, shadcn 디자인 시스템) |
| `e2e/` | 진짜 서버와 빌드된 화면을 브라우저로 여는 테스트 (Playwright) |
| `scripts/` | 개발 도구 |
| `db/schema.sql` | 기존 책 DB의 스키마 |
| `dev-data/` | 개발용 사본 (git 밖) |

## 문서

- `docs/stack.md` — 무엇으로 짓는지와 이유
- `docs/data-contract.md` — 기존 책 DB를 읽고 쓸 때 지킬 것
- `docs/architecture.md` — 방향과 근거
