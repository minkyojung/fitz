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
