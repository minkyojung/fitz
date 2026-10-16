"""Filter OCR garbage from photo pages and decorative numerals."""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

WORDS = Path("/usr/share/dict/words")
SHORT = 12
MIN_DICT_RATIO = 0.5
MAX_SYMBOL_RATIO = 0.25
TINY = {"a", "i", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my",
        "no", "of", "on", "or", "so", "to", "up", "us", "we"}


@lru_cache(maxsize=1)
def _dictionary() -> frozenset[str]:
    return frozenset(w.strip().lower() for w in WORDS.read_text().splitlines())


def _known(t: str) -> bool:
    if t.isdigit():
        return len(t) >= 2
    return t in TINY or (len(t) > 2 and t in _dictionary())


def is_photo_page(lines: list[str]) -> bool:
    """A scanned photo page yields garbage lines; real prose is mostly dictionary words."""
    toks = [t for t in (re.sub(r"[^A-Za-z0-9]", "", r).lower() for l in lines for r in l.split()) if t]
    return bool(toks) and sum(map(_known, toks)) / len(toks) < MIN_DICT_RATIO


def is_junk(text: str) -> bool:
    raw = text.split()
    toks = [t for t in (re.sub(r"[^A-Za-z0-9]", "", r).lower() for r in raw) if t]
    if not toks:
        return True
    if len(toks) > SHORT:
        return False
    compact = text.replace(" ", "")
    symbols = sum(1 for c in compact if not c.isalnum() and c not in "“”‘’\"'.,;:!?-—()")
    if symbols / len(compact) > MAX_SYMBOL_RATIO:
        return True
    known = sum(1 for t in toks if _known(t))
    if len(toks) == 1:
        return not (_known(toks[0]) and len(toks[0]) >= 2)
    if len(toks) <= 3:
        return known < len(toks)
    return known / len(toks) < MIN_DICT_RATIO
