"""Assemble page lines into paragraphs that may span pages.

Signals (all geometric, measured on this book):
- paragraph start: first line indented ≥ INDENT_MIN past the page's left margin,
  or preceded by a vertical gap larger than a normal line pitch
- paragraph end: line ends well short of the right margin
- block quote: a run of indented lines where each line but the last reaches the
  right margin (one-line dialogue paragraphs are indented too, but end short).
  Known limit: ragged letters/verse come out as short paragraphs; the reviewer
  re-tags them.
- chapter opener: a page with no running head whose first line is centred and
  separated from the body by a large gap (titles are finally taken from the TOC;
  the detected line only serves to keep it out of the body)
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from .pdf import Line, Page
from .text import join_lines

INDENT_MIN = 8.0
SHORT_LINE_MIN = 20.0
GAP_FACTOR = 1.5
OPENER_GAP = 60.0


@dataclass
class Para:
    kind: str  # paragraph | heading
    lines: list[str] = field(default_factory=list)
    page_start: int = 0
    page_end: int = 0
    starts_new: bool = True  # first line looked like a paragraph start
    ends: bool = True  # last line looked like a paragraph end

    @property
    def text(self) -> str:
        return join_lines(self.lines)


def _mode(values: list[float], bucket: float = 2.0) -> float:
    c = Counter(round(v / bucket) * bucket for v in values)
    return c.most_common(1)[0][0]


def _left_margin(body: list[Line]) -> float:
    """Flush-left lines are the minority on quote-heavy pages, so use a low percentile, not the mode."""
    xs = sorted(l.x0 for l in body)
    return xs[int(len(xs) * 0.15)]


def page_paragraphs(page: Page) -> list[Para]:
    lines = page.lines
    if not lines:
        return []
    paras: list[Para] = []
    body = lines
    # chapter opener: centred title, big gap to body
    if len(lines) >= 2 and lines[1].y0 - lines[0].y0 > OPENER_GAP:
        title = lines[0]
        centre = (title.x0 + title.x1) / 2
        if abs(centre - page.width / 2) < page.width * 0.15:
            paras.append(Para("heading", [title.text], page.printed_no, page.printed_no))
            body = lines[1:]
    if not body:
        return paras
    left = _left_margin(body)
    right = sorted(l.x1 for l in body)[int((len(body) - 1) * 0.85)]
    pitch = _mode([b.y0 - a.y0 for a, b in zip(body, body[1:])]) if len(body) > 1 else 14.0
    indented = [l.x0 - left >= INDENT_MIN for l in body]
    full = [l.x1 >= right - SHORT_LINE_MIN for l in body]
    in_block = _block_runs(indented, full)
    cur: Para | None = None
    prev: Line | None = None
    for i, l in enumerate(body):
        gap = prev is not None and (l.y0 - prev.y0) > pitch * GAP_FACTOR
        kind = "blockquote" if in_block[i] else "paragraph"
        new = cur is None or gap or kind != cur.kind or (indented[i] and not in_block[i])
        if new:
            if cur is not None:
                cur.ends = prev.x1 < right - SHORT_LINE_MIN if prev else True
                paras.append(cur)
            cur = Para(kind, [], page.printed_no, page.printed_no, starts_new=indented[i] or gap)
        cur.lines.append(l.text)
        prev = l
    assert cur is not None and prev is not None
    cur.ends = prev.x1 < right - SHORT_LINE_MIN
    paras.append(cur)
    return paras


def _block_runs(indented: list[bool], full: list[bool]) -> list[bool]:
    """A block starts at a full-width indented line followed by an indented line, and
    continues while the previous line was in the block and full-width."""
    n = len(indented)
    out = [False] * n
    for i in range(n):
        starts = indented[i] and full[i] and i + 1 < n and indented[i + 1]
        continues = i > 0 and out[i - 1] and full[i - 1] and indented[i]
        out[i] = starts or continues
    return out


def merge_across_pages(per_page: list[list[Para]]) -> list[Para]:
    out: list[Para] = []
    for paras in per_page:
        for p in paras:
            last = out[-1] if out else None
            continues = (
                last is not None
                and last.kind == p.kind == "paragraph"
                and not p.starts_new
                and not last.ends
            )
            if continues:
                last.lines.extend(p.lines)
                last.page_end = p.page_end
                last.ends = p.ends
            else:
                out.append(p)
    return out
