from pipeline.notes import anchor_quote, parse_notes
from pipeline.pdf import Line, Page


def test_parse_hanging_indent_entries():
    p = Page(1, 360.0, 568.0, printed_no=247)
    p.lines = [
        Line(150, 85, 210, 95, "Notes"),
        Line(150, 194, 210, 204, "Selma"),
        Line(19, 205, 320, 215, "4 came to Selma: Interview with"),
        Line(37, 216, 320, 226, "the family, 2010."),
        Line(19, 228, 320, 238, "a banana man: Cohen papers."),
    ]
    e = parse_notes([p])
    assert [(x.chapter_title, x.orig_page, x.quote, x.body) for x in e] == [
        ("Selma", 4, "came to Selma", "Interview with the family, 2010."),
        ("Selma", None, "a banana man", "Cohen papers."),
    ]


def test_anchor_tolerates_ocr_noise():
    cands = [(1, "He arrived in town broke."), (2, "Years later he came to Selma with nothing but a suitcase.")]
    a = anchor_quote("came to Se1ma with nothing", cands)
    assert a is not None and a.segment_index == 2
    assert "Selma" in a.exact and a.prefix.endswith("he ")


def test_anchor_rejects_unrelated():
    assert anchor_quote("entirely different words", [(1, "He arrived in town broke.")]) is None
