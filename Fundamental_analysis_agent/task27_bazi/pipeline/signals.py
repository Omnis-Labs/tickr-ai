"""八字 presentation: build the 命盤 chart, readings, and the reasoning chain."""

from __future__ import annotations

from datetime import date

from task27_bazi.pipeline import bazi as B
from task27_bazi.schemas import BaziChart, Pillar


def build_chart(listing: date, *, data_limit: bool) -> tuple[BaziChart, dict]:
    pillars = B.four_pillars(listing)
    fav = B.strength_and_favourable(pillars)
    counts: dict[str, int] = {e: 0 for e in ("木", "火", "土", "金", "水")}
    for key in ("year", "month", "day", "hour"):
        counts[pillars[key]["stem_elem"]] += 1
        counts[pillars[key]["branch_elem"]] += 1
    roles = {"year": "年", "month": "月", "day": "日", "hour": "時"}
    chart = BaziChart(
        listing_date=listing, listing_date_is_data_limit=data_limit,
        pillars=[Pillar(role=roles[k], gz=pillars[k]["gz"], stem=pillars[k]["stem"],
                        branch=pillars[k]["branch"], stem_elem=pillars[k]["stem_elem"],
                        branch_elem=pillars[k]["branch_elem"], zodiac=pillars[k]["zodiac"])
                 for k in ("year", "month", "day", "hour")],
        day_master=fav["day_master"], dm_elem=fav["dm_elem"],
        strength_label=fav["label"], favourable=fav["favourable"], element_counts=counts,
    )
    return chart, fav


def bazi_readings(chart: BaziChart, as_of: date) -> dict[str, float | str]:
    ly = B.liunian_elem(as_of)
    return {
        "bazi_regime": "favourable_year" if ly in chart.favourable else "unfavourable_year",
        "day_master": f"{chart.day_master}（{chart.dm_elem}）",
        "strength": chart.strength_label,
        "favourable_elements": "、".join(chart.favourable),
        "current_liunian_elem": ly,
        "element_spread": " ".join(f"{k}{v}" for k, v in chart.element_counts.items()),
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["bazi_regime", "day_master", "strength", "favourable_elements",
             "current_liunian_elem", "element_spread"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def reasoning_chain(chart: BaziChart, as_of: date) -> list[str]:
    p = {pl.role: pl for pl in chart.pillars}
    ly = B.liunian_elem(as_of)
    lm = B.liuyue_elem(as_of)
    return [
        f"起盤（上市 {chart.listing_date.isoformat()}）：年 {p['年'].gz}、月 {p['月'].gz}、"
        f"日 {p['日'].gz}、時 {p['時'].gz}（時柱以開盤 09:30＝巳時為準）。",
        f"日主：{chart.day_master}（{chart.dm_elem}），即此公司之「我」。",
        f"旺衰：{chart.strength_label}；五行分布 {' '.join(f'{k}{v}' for k, v in chart.element_counts.items())}。",
        f"喜用神：{'、'.join(chart.favourable)} —— {'身強則喜洩剋耗以洩其旺' if chart.strength_label.startswith('身強') else '身弱則喜生扶以助其弱'}。",
        f"流年五行＝{ly}、流月五行＝{lm}（隨日期確定性推算）。",
        f"訊號：流年 {ly} {'屬喜用 → 持有' if ly in chart.favourable else '為忌 → 空手'}。",
    ]
