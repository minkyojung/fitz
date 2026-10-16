from pipeline.junk import is_junk


def test_garbage_is_junk():
    assert is_junk("m) adhd")
    assert is_junk("=")
    assert is_junk("Sie) (bp well lyrinn heap Seika? Mibdy")


def test_real_short_text_is_kept():
    assert not is_junk("ten")
    assert not is_junk("Was there a precursor?")
    assert not is_junk("“Just a little chill, amigo.”")


def test_symbol_soup_and_fragments_are_junk():
    for t in [": ie A,", "3 a", "a 7", "a", "Y ~ i ; i} { if", "fo ud ee ay ee A", "mts, on |"]:
        assert is_junk(t), t
    assert not is_junk("Indirection.")
    assert not is_junk("Of course they did.")


def test_photo_page_detection():
    from pipeline.junk import is_photo_page
    assert is_photo_page(["m) adhd", "Y ~ i ; i} { if", "fo ud ee ay ee A", "a caption of real words"])
    assert not is_photo_page(["Of course they did.", "He arrived in town broke.", "“Yes.”"])
