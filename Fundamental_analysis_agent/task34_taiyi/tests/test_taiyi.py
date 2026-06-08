from datetime import date
from task34_taiyi.pipeline import taiyi as T
from task34_taiyi.schemas import TaiyiSpec
def test_counts_and_palace():
    h, g = T.host_guest(date(2024, 6, 1))
    assert 0 <= h < 360 and 0 <= g < 360
    assert T.taiyi_palace(date(2024, 6, 1)) in [p + "" for p in T.PALACES]
def test_host_wins_consistent():
    d = date(2024, 6, 1)
    h, g = T.host_guest(d)
    assert T.host_wins(d) == (h >= g)
def test_want_long_modes():
    wl = T.make_want_long(TaiyiSpec(entry_signal="host_prevails"))
    for y in (2021, 2022, 2023, 2024, 2025):
        assert wl(date(y, 6, 1)) == T.host_wins(date(y, 6, 1))
    assert T.make_want_long(TaiyiSpec(entry_signal="buy_and_hold"))(date(2024, 1, 1))
