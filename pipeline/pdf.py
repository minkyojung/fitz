"""Read the PDF text layer into geometry-aware lines. Fragments on the same baseline are merged."""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

SAME_LINE_TOLERANCE = 3.0  # pt
RUNNING_HEAD_MAX_Y = 30.0  # pt from top
# "12 « The Fish That Ate the Whale"  /  "The Banana War « 113" — OCR renders the separator glyph variously
_RUNNING_HEAD = re.compile(r"^(?:(\d{1,3})\s*[«»=*]+\s*\D.*|.*\D\s*[«»=*]+\s*(\d{1,3}))$")


@dataclass
class Line:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str


@dataclass
class Page:
    pdf_index: int  # 1-based
    width: float
    height: float
    lines: list[Line] = field(default_factory=list)
    printed_no: int | None = None  # filled by assign_printed_numbers


def _merge_fragments(raw: list[Line]) -> list[Line]:
    raw.sort(key=lambda l: (l.y0, l.x0))
    out: list[Line] = []
    for l in raw:
        if out and abs(out[-1].y0 - l.y0) < SAME_LINE_TOLERANCE:
            p = out[-1]
            p.x0, p.x1 = min(p.x0, l.x0), max(p.x1, l.x1)
            p.y1 = max(p.y1, l.y1)
            p.text = f"{p.text} {l.text}"
        else:
            out.append(l)
    return out


def read_pages(pdf_path: str) -> list[Page]:
    doc = pymupdf.open(pdf_path)
    pages: list[Page] = []
    for i, p in enumerate(doc):
        raw: list[Line] = []
        for b in p.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for l in b["lines"]:
                text = "".join(s["text"] for s in l["spans"]).strip()
                if text:
                    x0, y0, x1, y1 = l["bbox"]
                    raw.append(Line(x0, y0, x1, y1, text))
        pages.append(Page(i + 1, p.rect.width, p.rect.height, _merge_fragments(raw)))
    return pages


def running_head_number(page: Page) -> int | None:
    """Printed page number from the running head, if the page has one."""
    if not page.lines or page.lines[0].y0 > RUNNING_HEAD_MAX_Y:
        return None
    m = _RUNNING_HEAD.match(page.lines[0].text)
    if not m:
        return None
    return int(m.group(1) or m.group(2))


def strip_running_head(page: Page) -> None:
    if page.lines and page.lines[0].y0 <= RUNNING_HEAD_MAX_Y:
        page.lines.pop(0)


def assign_printed_numbers(pages: list[Page]) -> int:
    """Printed numbering is pdf_index - offset. The offset is the mode over all parsable running heads.
    Returns the offset. Raises if the heads disagree too much (layout assumption broken)."""
    offsets = Counter()
    for p in pages:
        n = running_head_number(p)
        if n is not None:
            offsets[p.pdf_index - n] += 1
    if not offsets:
        raise RuntimeError("no running heads with page numbers found")
    offset, votes = offsets.most_common(1)[0]
    total = sum(offsets.values())
    if votes / total < 0.9:
        raise RuntimeError(f"page-number offset unstable: {offsets.most_common(3)}")
    for p in pages:
        p.printed_no = p.pdf_index - offset
    return offset
