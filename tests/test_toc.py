from pipeline.toc import parse_toc


def test_parses_entries_parts_and_ocr_noise():
    lines = ["Contents", "Preface * xiii", "Prologue = 3", "Green", "1:Selma * 11",
             "Tl: To the Isthmus and Back «= 99", "137 14: The Fish That Swallowed the Whale =", "Index = 000"]
    e = parse_toc(lines)
    assert [(x.title, x.page) for x in e] == [
        ("Preface", None), ("Prologue", 3), ("Green", None), ("1: Selma", 11),
        ("11: To the Isthmus and Back", 99), ("14: The Fish That Swallowed the Whale", 137), ("Index", 0),
    ]
