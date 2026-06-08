from datetime import date
from task33_liuren.pipeline import liuren as L
from task33_liuren.schemas import LiurenSpec
def test_branches_in_range():
    for m in range(1, 13):
        d = date(2024, m, 10)
        assert 0 <= L.yue_jiang_branch(d) < 12 and 0 <= L.yong_branch(d) < 12
def test_relation_logic():
    # 用神生日主: 木 day master, 用神 水 (水生木) → good
    rel, good = L._relation("木", "水"); assert good and "生" in rel
    rel2, good2 = L._relation("木", "金"); assert not good2  # 金剋木 用神剋日主
def test_want_long_matches():
    wl = L.make_want_long(LiurenSpec(entry_signal="yong_supports"), "木")
    for m in range(1, 13):
        d = date(2024, m, 5)
        g, _ = L.auspicious(d, "木"); assert wl(d) == g
    assert L.make_want_long(LiurenSpec(entry_signal="buy_and_hold"), "木")(date(2024, 6, 1))
