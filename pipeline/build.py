"""Build the canonical source database from the PDF.

usage: uv run python -m pipeline.build --pdf BOOK.pdf --out OUTDIR [--no-images]
Produces OUTDIR/book.db, OUTDIR/pages/*.png and OUTDIR/report.json.
"""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz

from . import db, images
from .junk import is_junk, is_photo_page
from .layout import Box, merge_across_pages, page_paragraphs
from .notes import anchor_quote, parse_notes
from .pdf import assign_printed_numbers, read_pages, strip_running_head
from .toc import parse_toc

TITLE = "The Fish That Ate the Whale"
AUTHOR = "Rich Cohen"
TOC_PDF_PAGES = (13, 14)
BACK_MATTER = {"notes", "bibliography", "index"}  # not translated as body


@dataclass
class SegmentRow:
    kind: str
    page_start: int
    page_end: int
    text: str
    boxes: dict[int, Box]


def chapter_segments(by_pdf: dict, start_page: int, end_page: int, offset: int, title: str) -> tuple[list[SegmentRow], int]:
    """Paragraph rows for one chapter (printed pages start_page..end_page-1). The TOC title is the
    canonical heading; a detected opener line only lends its box. Returns (rows, junk_dropped)."""
    start_pdf, end_pdf = start_page + offset, end_page + offset - 1
    per_page = [page_paragraphs(by_pdf[i]) for i in range(start_pdf, end_pdf + 1) if i in by_pdf]
    paras = merge_across_pages(per_page)
    heading = re.sub(r"^\d{1,2}:\s*", "", title)
    rows = [SegmentRow("heading", start_page, start_page, heading, {})]
    junk = 0
    for para in paras:
        text = para.text
        if para.kind == "heading" or fuzz.ratio(text.lower(), heading.lower()) > 80:
            if not rows[0].boxes:
                rows[0].boxes = dict(para.boxes)
            continue
        if is_junk(text):
            junk += 1
            continue
        rows.append(SegmentRow(para.kind, para.page_start, para.page_end, text, dict(para.boxes)))
    return rows, junk


def build(pdf: Path, out: Path, with_images: bool) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    pages = read_pages(str(pdf))
    offset = assign_printed_numbers(pages)
    by_pdf = {p.pdf_index: p for p in pages}

    toc_lines = [l.text for i in TOC_PDF_PAGES for l in by_pdf[i].lines]
    toc = parse_toc(toc_lines)
    chapters = [e for e in toc if e.page is not None and e.page > 0]
    body_chapters = [c for c in chapters if c.title.lower() not in BACK_MATTER]
    notes_entry = next(c for c in chapters if c.title.lower() == "notes")
    notes_end = next(c.page for c in chapters if c.title.lower() == "bibliography")

    photo_pages = 0
    for p in pages:
        strip_running_head(p)
        if is_photo_page([l.text for l in p.lines]):
            p.lines.clear()
            photo_pages += 1

    conn = db.create(out / "book.db")
    book_id = conn.execute(
        "INSERT INTO book(title, author, source_pdf) VALUES (?,?,?)", (TITLE, AUTHOR, str(pdf))
    ).lastrowid

    img_dir = out / "pages"
    if with_images:
        images.render_pages(pdf, img_dir)
    conn.executemany(
        "INSERT INTO page(book_id, page_no, pdf_index, image_path) VALUES (?,?,?,?)",
        [(book_id, p.printed_no, p.pdf_index, str(images.image_path(img_dir, p.pdf_index, len(pages)))) for p in pages],
    )

    # body segments per chapter
    chapter_ids: dict[str, int] = {}
    stats_hyphen = 0
    junk_dropped = 0
    boxes_total = 0
    for ci, ch in enumerate(body_chapters):
        nxt = body_chapters[ci + 1].page if ci + 1 < len(body_chapters) else notes_entry.page
        rows, junk = chapter_segments(by_pdf, ch.page, nxt, offset, ch.title)
        junk_dropped += junk
        cid = conn.execute(
            "INSERT INTO chapter(book_id, idx, title, start_page) VALUES (?,?,?,?)", (book_id, ci, ch.title, ch.page)
        ).lastrowid
        chapter_ids[_norm(ch.title)] = cid
        for si, r in enumerate(rows):
            stats_hyphen += len(re.findall(r"\w- \w", r.text))
            sid = conn.execute(
                "INSERT INTO segment(chapter_id, idx, kind, page_start, page_end, ocr_text, source_doc, source_text)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (cid, si, r.kind, r.page_start, r.page_end, r.text, db.pm_doc(r.text), r.text),
            ).lastrowid
            conn.executemany(
                "INSERT INTO segment_box(segment_id, page_no, x0, y0, x1, y1) VALUES (?,?,?,?,?,?)",
                [(sid, pg, *box) for pg, box in r.boxes.items()],
            )
            boxes_total += bool(r.boxes)

    # notes
    note_pages = [by_pdf[i] for i in range(notes_entry.page + offset, notes_end + offset) if i in by_pdf]
    entries = parse_notes(note_pages)
    anchored = 0
    for e in entries:
        cid = _match_chapter(e.chapter_title, chapter_ids)
        if cid is None:
            continue
        cands = conn.execute(
            "SELECT id, source_text FROM segment WHERE chapter_id=? AND kind='paragraph'"
            + (" AND ? BETWEEN page_start AND page_end" if e.orig_page else " AND ?"),
            (cid, e.orig_page or 1),
        ).fetchall()
        a = anchor_quote(e.quote, cands)
        if a is None and e.orig_page:  # page hint may be off by one; retry chapter-wide
            cands = conn.execute("SELECT id, source_text FROM segment WHERE chapter_id=? AND kind='paragraph'", (cid,)).fetchall()
            a = anchor_quote(e.quote, cands)
        seg_id = a.segment_index if a else cands[0][0] if cands else None
        if seg_id is None:
            continue
        anchored += a is not None
        conn.execute(
            "INSERT INTO note(segment_id, kind, src_exact, src_prefix, src_suffix, src_start, src_end,"
            " orig_page, orig_quote, body_source, anchored) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (seg_id, "author", a.exact if a else None, a.prefix if a else None, a.suffix if a else None,
             a.start if a else None, a.end if a else None, e.orig_page, e.quote, e.body, int(a is not None)),
        )
    conn.commit()

    n_seg = conn.execute("SELECT count(*) FROM segment").fetchone()[0]
    report = {
        "pages": len(pages),
        "page_offset": offset,
        "toc_chapters": len(body_chapters),
        "chapters_in_db": conn.execute("SELECT count(*) FROM chapter").fetchone()[0],
        "segments": n_seg,
        "headings": conn.execute("SELECT count(*) FROM segment WHERE kind='heading'").fetchone()[0],
        "blockquotes": conn.execute("SELECT count(*) FROM segment WHERE kind='blockquote'").fetchone()[0],
        "photo_pages_dropped": photo_pages,
        "junk_dropped": junk_dropped,
        "residual_hyphen_breaks": stats_hyphen,
        "segments_with_boxes": boxes_total,
        "notes_parsed": len(entries),
        "notes_anchored": anchored,
        "notes_anchor_rate": round(anchored / len(entries), 3) if entries else None,
    }
    (out / "report.json").write_text(json.dumps(report, indent=2))
    conn.close()
    return report


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def _match_chapter(title: str, chapter_ids: dict[str, int]) -> int | None:
    key = _norm(title)
    if key in chapter_ids:
        return chapter_ids[key]
    for k, v in chapter_ids.items():  # notes headings omit the number: "Selma" vs "1: Selma"
        if k.endswith(key) or key.endswith(k):
            return v
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--no-images", action="store_true")
    a = ap.parse_args()
    try:
        print(json.dumps(build(a.pdf, a.out, not a.no_images), indent=2))
    except db.EditedDatabaseError as e:
        raise SystemExit(f"refused: {e}")


if __name__ == "__main__":
    main()
