from pipeline.text import join_lines


def test_joins_plain_lines():
    assert join_lines(["one two", "three"]) == "one two three"


def test_repairs_soft_hyphen():
    assert join_lines(["an exam-", "ple here"]) == "an example here"


def test_keeps_hyphen_before_capital():
    assert join_lines(["the Anglo-", "American pact"]) == "the Anglo- American pact"


def test_skips_blank_lines_and_collapses_space():
    assert join_lines(["a  b", "", "  c "]) == "a b c"
