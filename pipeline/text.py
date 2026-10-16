"""Line joining and de-hyphenation."""
from __future__ import annotations

import re

_HYPHEN_END = re.compile(r"(\w)-$")


def join_lines(lines: list[str]) -> str:
    """Join physical lines into one paragraph string, repairing end-of-line hyphenation.

    'exam-' + 'ple' → 'example'. A hyphen before a capitalised or digit-initial
    continuation is kept ('Anglo-' + 'American' → 'Anglo-American')."""
    out = ""
    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        if not out:
            out = s
            continue
        if _HYPHEN_END.search(out) and s[0].islower():
            out = out[:-1] + s
        else:
            out = f"{out} {s}"
    return re.sub(r"\s+", " ", out)
