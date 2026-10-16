"""Parse the book's Notes section (hanging-indent entries grouped under chapter headings)
and anchor each entry to a body segment by fuzzy-matching its quoted phrase."""
from __future__ import annotations

import re
from dataclasses import dataclass

from rapidfuzz import fuzz

from .pdf import Page
from .text import join_lines

HANG_INDENT_MIN = 10.0
ANCHOR_THRESHOLD = 85
_LEAD_PAGE = re.compile(r"^(\d{1,3})\s+")


@dataclass
class NoteEntry:
    chapter_title: str
    orig_page: int | None
    quote: str
    body: str


@dataclass
class Anchor:
    segment_index: int
    exact: str
    prefix: str
    suffix: str
    start: int
    end: int
    score: float


def parse_notes(pages: list[Page]) -> list[NoteEntry]:
    entries: list[NoteEntry] = []
    chapter = ""
    cur: list[str] | None = None

    def flush() -> None:
        nonlocal cur
        if cur:
            entries.append(_split_entry(chapter, join_lines(cur)))
        cur = None

    for page in pages:
        if not page.lines:
            continue
        left = min(l.x0 for l in page.lines)
        for l in page.lines:
            centred = abs((l.x0 + l.x1) / 2 - page.width / 2) < page.width * 0.1 and l.x0 - left > 40
            if centred:
                flush()
                chapter = l.text
            elif l.x0 - left < HANG_INDENT_MIN:
                flush()
                cur = [l.text]
            elif cur is not None:
                cur.append(l.text)
    flush()
    return entries


def _split_entry(chapter: str, text: str) -> NoteEntry:
    page = None
    m = _LEAD_PAGE.match(text)
    if m:
        page = int(m.group(1))
        text = text[m.end():]
    quote, sep, body = text.partition(":")
    if not sep:
        quote, body = "", text
    return NoteEntry(chapter, page, quote.strip().strip("“”\"'"), body.strip())


def anchor_quote(quote: str, candidates: list[tuple[int, str]], context: int = 32) -> Anchor | None:
    """Find the best segment containing `quote`. candidates: (segment_index, source_text)."""
    if not quote:
        return None
    best: Anchor | None = None
    for idx, text in candidates:
        a = fuzz.partial_ratio_alignment(quote, text)
        if a is None or a.score < ANCHOR_THRESHOLD:
            continue
        if best is None or a.score > best.score:
            s, e = a.dest_start, a.dest_end
            best = Anchor(idx, text[s:e], text[max(0, s - context):s], text[e:e + context], s, e, a.score)
    return best
