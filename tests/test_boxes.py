from pipeline.boxes import _fuzzy


def test_fuzzy_matches_a_split_half_to_its_parent_on_the_same_page():
    parent = "alpha beta gamma delta epsilon zeta eta theta iota kappa"
    cands = [(parent, {11: [0.1, 0.2, 0.9, 0.3]}), ("unrelated words entirely", {11: [0.1, 0.5, 0.9, 0.6]})]
    assert _fuzzy("epsilon zeta eta theta", cands, 11, 11) == {11: [0.1, 0.2, 0.9, 0.3]}


def test_fuzzy_matches_a_merged_text_to_a_contained_paragraph():
    cands = [("beta gamma delta", {4: [0.1, 0.2, 0.9, 0.3]})]
    assert _fuzzy("alpha beta gamma delta epsilon", cands, 4, 5) is not None


def test_fuzzy_ignores_other_pages_and_weak_matches():
    cands = [("alpha beta gamma", {7: [0.1, 0.2, 0.9, 0.3]})]
    assert _fuzzy("alpha beta gamma", cands, 11, 11) is None
    assert _fuzzy("completely different", [("alpha beta gamma", {11: [0, 0, 1, 1]})], 11, 11) is None
