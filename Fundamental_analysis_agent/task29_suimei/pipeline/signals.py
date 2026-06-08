"""四柱推命 presentation: readings, reasoning chain, chart helpers."""

from __future__ import annotations

from datetime import date

from task29_suimei.pipeline import suimei as S
from task29_suimei.schemas import Pillar, SuimeiChart


def build_chart_model(listing: date, data_limit: bool, as_of: date) -> SuimeiChart:
    c = S.build_chart(listing)
    lb = S.liunian_branch(as_of)
    return SuimeiChart(
        listing_date=listing, listing_date_is_data_limit=data_limit,
        day_master=c["day_master"], day_master_elem=c["day_master_elem"], tenchusatsu=c["tenchusatsu"],
        pillars=[Pillar(role=p["role"], gz=p["gz"], stem=p["stem"], branch=p["branch"],
                        twelve_fortune=p["twelve_fortune"], hidden=p["hidden"]) for p in c["pillars"]],
        liunian_branch=S.BRANCHES[lb],
        liunian_fortune=S.twelve_fortune(c["day_stem_idx"], lb),
        liunian_in_tenchusatsu=lb in c["void"],
    )


def suimei_readings(chart: SuimeiChart) -> dict[str, float | str]:
    if chart.liunian_in_tenchusatsu:
        regime = "tenchusatsu"
    elif chart.liunian_fortune in S.THRIVING:
        regime = "thriving"
    elif chart.liunian_fortune in S.WEAK:
        regime = "declining"
    else:
        regime = "neutral"
    return {
        "suimei_regime": regime,
        "day_master": f"{chart.day_master}（{chart.day_master_elem}）",
        "tenchusatsu": chart.tenchusatsu,
        "liunian_branch": chart.liunian_branch,
        "liunian_twelve_fortune": chart.liunian_fortune,
        "in_tenchusatsu": "是" if chart.liunian_in_tenchusatsu else "否",
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["suimei_regime", "day_master", "tenchusatsu", "liunian_branch",
             "liunian_twelve_fortune", "in_tenchusatsu"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def reasoning_chain(chart: SuimeiChart, as_of: date) -> list[str]:
    return [
        f"立式（上市 {chart.listing_date.isoformat()}，時柱以開盤 09:30＝巳刻）：" +
        "／".join(f"{p.role}柱 {p.gz}（{p.twelve_fortune}）" for p in chart.pillars) + "。",
        f"日主：{chart.day_master}（{chart.day_master_elem}）—— 以日干為「己」，論十二運星之旺衰。",
        f"天中殺（空亡）：{chart.tenchusatsu} —— 日本流派視為論命主軸（細木数子六星占術之本）。",
        f"流年 {chart.liunian_branch}：日主十二運＝{chart.liunian_fortune}"
        + ("，且落天中殺。" if chart.liunian_in_tenchusatsu else "。"),
        f"訊號：{'空手（天中殺／衰絕之運，宜潛伏）' if (chart.liunian_in_tenchusatsu or chart.liunian_fortune in S.WEAK) else '持有（旺相之運）' if chart.liunian_fortune in S.THRIVING else '依規則判定'}。",
    ]
