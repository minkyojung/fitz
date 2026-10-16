from pipeline.layout import merge_across_pages, page_paragraphs
from pipeline.pdf import Line, Page


def _page(no, rows, width=360.0):
    # rows: (x0, y0, x1, text); y pitch 14
    p = Page(pdf_index=no + 20, width=width, height=568.0, printed_no=no)
    p.lines = [Line(x0, y0, x1, y0 + 10, t) for x0, y0, x1, t in rows]
    return p


def test_indent_starts_new_paragraph_and_short_line_ends_it():
    p = _page(1, [
        (30, 100, 320, "First para line one"),
        (16, 114, 320, "first para line two"),
        (16, 128, 200, "first para ends short."),
        (30, 142, 320, "Second para"),
        (16, 156, 320, "continues to the page end"),
    ])
    paras = page_paragraphs(p)
    assert [q.text for q in paras] == [
        "First para line one first para line two first para ends short.",
        "Second para continues to the page end",
    ]
    assert paras[0].ends and not paras[1].ends


def test_paragraph_continues_across_page_break():
    a = _page(1, [(30, 100, 320, "Starts here and"), (16, 114, 320, "runs off the page")])
    b = _page(2, [(16, 40, 320, "onto the next one."), (30, 54, 200, "New para.")])
    merged = merge_across_pages([page_paragraphs(a), page_paragraphs(b)])
    assert [q.text for q in merged] == ["Starts here and runs off the page onto the next one.", "New para."]
    assert (merged[0].page_start, merged[0].page_end) == (1, 2)


def test_chapter_opener_heading():
    p = _page(3, [(150, 82, 210, "Selma"), (24, 188, 320, "Body starts here"), (16, 202, 200, "and ends.")])
    paras = page_paragraphs(p)
    assert paras[0].kind == "heading" and paras[0].text == "Selma"
    assert paras[1].text == "Body starts here and ends."


def test_indented_run_becomes_blockquote():
    p = _page(4, [
        (16, 100, 320, "Intro line that ends short."),
        (26, 114, 320, "Dear sir, I write to you"),
        (26, 128, 320, "from the isthmus"),
        (26, 142, 205, "with regards."),
        (16, 156, 320, "Back to prose, flush left as books set it."),
        (16, 170, 200, "The end."),
    ])
    paras = page_paragraphs(p)
    assert [(q.kind, q.text) for q in paras] == [
        ("paragraph", "Intro line that ends short."),
        ("blockquote", "Dear sir, I write to you from the isthmus with regards."),
        ("paragraph", "Back to prose, flush left as books set it. The end."),
    ]


def test_one_line_dialogue_paragraphs_are_not_a_blockquote():
    p = _page(5, [
        (16, 72, 320, "Earlier prose fills the measure on this page"),
        (16, 86, 320, "and keeps going to the right margin as usual."),
        (30, 100, 200, "“What are those?” he asked."),
        (30, 114, 180, "“Bananas,” said the captain."),
        (30, 128, 320, "He had never seen one before and"),
        (16, 142, 150, "wanted to try."),
    ])
    paras = page_paragraphs(p)
    assert [q.kind for q in paras] == ["paragraph"] * 4
    assert paras[3].text == "He had never seen one before and wanted to try."


def test_paragraph_box_is_the_union_of_its_lines_normalized_to_the_page():
    p = _page(1, [
        (30, 100, 320, "First para line one"),
        (16, 114, 200, "ends short."),
        (30, 128, 320, "Second."),
    ])
    paras = page_paragraphs(p)
    x0, y0, x1, y1 = paras[0].boxes[1]
    assert (round(x0 * 360), round(y0 * 568), round(x1 * 360), round(y1 * 568)) == (16, 100, 320, 124)
    assert set(paras[1].boxes) == {1}


def test_paragraph_across_pages_has_a_box_per_page():
    a = _page(1, [(30, 100, 320, "Starts here and"), (16, 114, 320, "runs off the page")])
    b = _page(2, [(16, 40, 320, "onto the next one."), (30, 54, 200, "New para.")])
    merged = merge_across_pages([page_paragraphs(a), page_paragraphs(b)])
    assert set(merged[0].boxes) == {1, 2}
    assert round(merged[0].boxes[2][1] * 568) == 40
