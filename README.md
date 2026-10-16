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

## 데이터 안전
- 에디터가 한 번이라도 쓰면 `meta.last_edit_at`이 기록되고, 이후 `pipeline.build`는 그 DB를 덮어쓰지 않는다 (다른 `--out`으로 빌드).
- `segment.ocr_text`는 파이프라인이 뽑은 원문이며 이후 불변. 스키마 변경 전 DB는 `uv run python -m pipeline.migrate out/book.db`로 올린다.
