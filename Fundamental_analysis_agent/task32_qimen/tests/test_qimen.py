from datetime import date
from task32_qimen.pipeline import qimen as Q
from task32_qimen.schemas import QimenSpec
def test_gate_in_range_and_classes():
    for doy_off in range(0, 360, 30):
        d = date(2024, 1, 1)
        g = Q.active_gate(date(2024, 1, 1).replace(month=(doy_off // 30) + 1))
        assert 0 <= g < 8
    assert Q.AUSPICIOUS == {0, 1, 7} and Q.ILL == {2, 5, 6}
def test_yang_yin_dun():
    assert Q.is_yang_dun(date(2024, 2, 1)) and not Q.is_yang_dun(date(2024, 8, 1))
def test_layout_has_eight_gates():
    lay = Q.gate_layout(date(2024, 3, 15))
    assert len(lay) == 8 and len({g["palace"] for g in lay}) == 8
def test_want_long_modes():
    spec = QimenSpec(entry_signal="auspicious_gate")
    wl = Q.make_want_long(spec)
    for m in range(1, 13):
        d = date(2024, m, 10)
        assert wl(d) == (Q.active_gate(d) in Q.AUSPICIOUS)
    assert Q.make_want_long(QimenSpec(entry_signal="buy_and_hold"))(date(2024, 6, 1))
