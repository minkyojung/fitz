"""Parse the printed table of contents into (title, printed_page) entries."""
from __future__ import annotations

import re
from dataclasses import dataclass

_ENTRY_TAIL = re.compile(r"^(?P<title>.+?)\s*[*=«»:]*\s*(?P<page>\d{1,3})$")
_ENTRY_HEAD = re.compile(r"^(?P<page>\d{1,3})\s+(?P<title>\d{1,2}:.+?)\s*[*=«»]*$")
_ROMAN_TAIL = re.compile(r"^(?P<title>.+?)\s*[*=«»]*\s*[ivxl]{1,6}$")  # front matter (roman numerals)


@dataclass
class TocEntry:
    title: str
    page: int | None  # None = part heading or roman-numbered front matter


def parse_toc(lines: list[str]) -> list[TocEntry]:
    entries: list[TocEntry] = []
    for raw in lines:
        s = re.sub(r"\s+", " ", raw).strip()
        if not s or s.lower() == "contents":
            continue
        r = _ROMAN_TAIL.match(s)
        if r:
            entries.append(TocEntry(r.group("title").strip(), None))
            continue
        m = _ENTRY_TAIL.match(s) or _ENTRY_HEAD.match(s)
        if m:
            title = re.sub(r"\s*[*=«»]+\s*$", "", m.group("title")).strip()
            title = re.sub(r"^(\d{1,2}|Tl|TI|ll)\s*:\s*", lambda g: f"{_fix_num(g.group(1))}: ", title)
            entries.append(TocEntry(title, int(m.group("page"))))
        elif len(s.split()) <= 3:
            entries.append(TocEntry(s, None))
    return entries


def _fix_num(s: str) -> str:
    return {"Tl": "11", "TI": "11", "ll": "11"}.get(s, s)
