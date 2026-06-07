"""VIX term-structure regime. Pure, deterministic, lookahead-free."""

from __future__ import annotations

from datetime import date

from task20_vix.schemas import PricePoint, VixSpec


def build_vix_map(vix: list[PricePoint], vix3m: list[PricePoint]) -> dict[date, tuple[float, float, float]]:
    """{date: (vix, vix3m, ratio)} on the dates VIX is available (VIX3M carried forward)."""
    v3 = {p.date: p.close for p in vix3m}
    out: dict[date, tuple[float, float, float]] = {}
    last3 = None
    for p in vix:
        if p.date in v3:
            last3 = v3[p.date]
        if last3 and last3 > 0:
            out[p.date] = (p.close, last3, p.close / last3)
    return out


def _asof(vix_map: dict[date, tuple[float, float, float]], sorted_dates: list[date], d: date):
    # most recent VIX reading on/before d
    import bisect
    i = bisect.bisect_right(sorted_dates, d) - 1
    return vix_map[sorted_dates[i]] if i >= 0 else None


def make_want_long(spec: VixSpec, vix_map: dict[date, tuple[float, float, float]]):
    sd = sorted(vix_map)

    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        v = _asof(vix_map, sd, d)
        if v is None:
            return True   # no VIX data → don't gate
        vix, _v3, ratio = v
        if spec.entry_signal == "vix_term_gate":
            return ratio < spec.term_threshold
        if spec.entry_signal == "vix_level_gate":
            return vix <= spec.level_threshold
        return True

    return want_long


def vix_readings(vix_map: dict[date, tuple[float, float, float]], as_of: date) -> dict[str, float | str]:
    if not vix_map:
        return {"vix_regime": "no_data"}
    sd = sorted(vix_map)
    vix, v3, ratio = vix_map[sd[-1]]
    ratios = [r for _, _, r in vix_map.values()]
    pctl = sum(1 for x in sorted(ratios) if x <= ratio) / len(ratios) * 100.0
    regime = "fear_inverted" if ratio >= 1.0 else "calm_contango"
    return {
        "vix_regime": regime,
        "current_vix": round(vix, 1),
        "current_vix3m": round(v3, 1),
        "term_ratio": round(ratio, 3),
        "term_ratio_percentile": round(pctl, 0),
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["vix_regime", "current_vix", "current_vix3m", "term_ratio", "term_ratio_percentile"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)
