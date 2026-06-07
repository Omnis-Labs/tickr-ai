"""梅花易數 signals: deterministic 體用生剋 verdict → want_long predicate + readings + chain."""

from __future__ import annotations

from datetime import date

from task26_meihua.pipeline.iching import TRIGRAMS, divine, line_diagram
from task26_meihua.schemas import HexagramChart, MeihuaSpec


def build_divinations(dates: list[date], seed: int) -> dict[date, dict]:
    return {d: divine(d, seed) for d in dates}


def make_want_long(spec: MeihuaSpec, divs: dict[date, dict]):
    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        div = divs.get(d)
        if div is None:
            return False
        if spec.entry_signal == "ti_yong_auspicious":
            return bool(div["auspicious"])
        if spec.entry_signal == "yang_ti":
            return bool(div["ti_is_yang"])
        return False

    return want_long


def to_chart(div: dict) -> HexagramChart:
    up, lo = div["upper"], div["lower"]
    return HexagramChart(
        upper=f"{up}{TRIGRAMS[up]['symbol']}", lower=f"{lo}{TRIGRAMS[lo]['symbol']}",
        moving_line=div["moving"], line_diagram=line_diagram(div),
        ben_gua=f"#{div['ben_num']} {div['ben_name']}",
        hu_gua=f"#{div['hu_num']} {div['hu_name']}",
        bian_gua=f"#{div['bian_num']} {div['bian_name']}",
        ti=f"{div['ti']}{TRIGRAMS[div['ti']]['symbol']}", yong=f"{div['yong']}{TRIGRAMS[div['yong']]['symbol']}",
        ti_wuxing=div["ti_wuxing"], yong_wuxing=div["yong_wuxing"],
        relation=div["relation"], verdict=div["verdict"], auspicious=div["auspicious"],
    )


def meihua_readings(div: dict) -> dict[str, float | str]:
    return {
        "gua_regime": "auspicious" if div["auspicious"] else "inauspicious",
        "ben_gua": f"#{div['ben_num']} {div['ben_name']}",
        "bian_gua": f"#{div['bian_num']} {div['bian_name']}",
        "ti_yong": f"體{div['ti']}({div['ti_wuxing']}) / 用{div['yong']}({div['yong_wuxing']})",
        "relation": div["relation"],
        "verdict": div["verdict"],
    }


def reasoning_chain(div: dict, as_of: date) -> list[str]:
    """The 起卦 → 體用 → 生剋 → 變卦 reasoning chain, step by step."""
    up, lo = div["upper"], div["lower"]
    return [
        f"起卦（{as_of.isoformat()}）：上卦 {up}{TRIGRAMS[up]['symbol']}（{TRIGRAMS[up]['wuxing']}）、"
        f"下卦 {lo}{TRIGRAMS[lo]['symbol']}（{TRIGRAMS[lo]['wuxing']}），動爻第 {div['moving']} 爻。",
        f"本卦：#{div['ben_num']} {div['ben_name']}；互卦：#{div['hu_num']} {div['hu_name']}（中段之象）。",
        f"體用：動爻在{'下卦' if div['moving'] <= 3 else '上卦'}，故 用卦={div['yong']}（{div['yong_wuxing']}）、"
        f"體卦={div['ti']}（{div['ti_wuxing']}）。",
        f"五行生剋：{div['relation']} → 斷曰「{div['verdict']}」。",
        f"變卦：動爻變出 #{div['bian_num']} {div['bian_name']}（事之終局）。",
        f"訊號：{'持有（體得生扶/可制用）' if div['auspicious'] else '空手（體受剋洩）'}。",
    ]


def readings_block(r: dict[str, float | str]) -> str:
    order = ["gua_regime", "ben_gua", "bian_gua", "ti_yong", "relation", "verdict"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)
