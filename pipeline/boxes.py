"""Fill segment_box for a database that was built before boxes existed (or was edited since).

Re-extracts paragraphs from the PDF and attaches their boxes to existing segments by text:
exact match on the immutable ocr_text first, then a fuzzy match for segments that were split
or merged in the editor. Only adds rows; never touches segments. Safe to re-run.

usage: uv run python -m pipeline.boxes --pdf BOOK.pdf --db out/book.db
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from rapidfuzz import fuzz

from .build import BACK_MATTER, TOC_PDF_PAGES, chapter_segments
from .junk import is_photo_page
from .pdf import assign_printed_numbers, read_pages, strip_running_head
from .toc import parse_toc

FUZZY_MIN = 90


def fill(pdf: Path, db_path: Path) -> dict:
    pages = read_pages(str(pdf))
    offset = assign_printed_numbers(pages)
    by_pdf = {p.pdf_index: p for p in pages}
    toc = parse_toc([l.text for i in TOC_PDF_PAGES for l in by_pdf[i].lines])
    chapters = [e for e in toc if e.page is not None and e.page > 0]
    body = [c for c in chapters if c.title.lower() not in BACK_MATTER]
    notes_page = next(c.page for c in chapters if c.title.lower() == "notes")
    for p in pages:
        strip_running_head(p)
        if is_photo_page([l.text for l in p.lines]):
            p.lines.clear()

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    stats = {"segments": 0, "already": 0, "exact": 0, "fuzzy": 0, "unmatched": 0}
    for ci, ch in enumerate(body):
        nxt = body[ci + 1].page if ci + 1 < len(body) else notes_page
        rows, _ = chapter_segments(by_pdf, ch.page, nxt, offset, ch.title)
        cands = [(r.text, r.boxes) for r in rows if r.boxes]
        by_text = {t: b for t, b in cands}
        chapter_id = conn.execute("SELECT id FROM chapter WHERE idx = ?", (ci,)).fetchone()
        if not chapter_id:
            continue
        segs = conn.execute(
            "SELECT id, ocr_text, source_text, page_start, page_end FROM segment WHERE chapter_id = ? ORDER BY idx",
            (chapter_id[0],),
        ).fetchall()
        for sid, ocr, text, ps, pe in segs:
            stats["segments"] += 1
            if conn.execute("SELECT 1 FROM segment_box WHERE segment_id = ?", (sid,)).fetchone():
                stats["already"] += 1
                continue
            key = ocr if ocr is not None else text
            boxes = by_text.get(key)
            how = "exact"
            if boxes is None:
                boxes, how = _fuzzy(key, cands, ps, pe), "fuzzy"
            if not boxes:
                stats["unmatched"] += 1
                continue
            stats[how] += 1
            conn.executemany(
                "INSERT INTO segment_box(segment_id, page_no, x0, y0, x1, y1) VALUES (?,?,?,?,?,?)",
                [(sid, pg, *b) for pg, b in boxes.items() if ps <= pg <= pe] or [(sid, pg, *b) for pg, b in boxes.items()],
            )
    conn.commit()
    conn.close()
    return stats


def _fuzzy(text: str, cands: list[tuple[str, dict]], ps: int, pe: int) -> dict | None:
    """Best paragraph containing this text (split) or contained by it (merge), on the same pages."""
    best, best_score = None, 0.0
    for ctext, boxes in cands:
        if not any(ps <= pg <= pe for pg in boxes):
            continue
        score = max(fuzz.partial_ratio(text, ctext), fuzz.partial_ratio(ctext, text))
        if score > best_score:
            best, best_score = boxes, score
    return best if best_score >= FUZZY_MIN else None


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True, type=Path)
    ap.add_argument("--db", required=True, type=Path)
    a = ap.parse_args()
    print(json.dumps(fill(a.pdf, a.db), indent=2))
