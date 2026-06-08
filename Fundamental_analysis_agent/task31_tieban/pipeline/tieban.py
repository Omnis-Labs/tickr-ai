"""鐵板神數 (Iron-Plate Numerology) deterministic engine. Offline, lookahead-free.

The real 鐵板神數 derives eerily-specific 條文 (fate verses) from a secret, proprietary
萬言書 via opaque 起數/考刻 methods — there is NO public algorithm. So this is an HONEST
STAND-IN: a deterministic 太玄數 起數 over the natal 八字 (each 干支 → its 太玄數), giving a
命數 (太極數); the 流年's verse number = 命數 + 流年干支數, and a 吉/平/凶 verdict from it.
The LLM writes a 條文-style verse for flavour; the backtest only reads the deterministic
verdict. Reuses Task 27's 干支 calendar.

⚠️ CONTROL / PLACEBO — no economic mechanism, and the 條文 system itself is legendary/
proprietary, so even the "authentic" version would not be reproducible. Doubly a placebo.
"""

from __future__ import annotations

from datetime import date

from task27_bazi.pipeline import bazi as B   # reuse the 干支 calendar

# 太玄數 — 天干: 甲己9 乙庚8 丙辛7 丁壬6 戊癸5 ; 地支: 子午9 丑未8 寅申7 卯酉6 辰戌5 巳亥4
_STEM_TAIXUAN = [9, 8, 7, 6, 5, 9, 8, 7, 6, 5]
_BRANCH_TAIXUAN = [9, 8, 7, 6, 5, 4, 9, 8, 7, 6, 5, 4]
_VERDICT = ["吉", "平", "凶"]   # verse number mod 3


def _gz_number(stem: int, branch: int) -> int:
    return _STEM_TAIXUAN[stem] + _BRANCH_TAIXUAN[branch]


def ming_number(listing: date) -> int:
    """命數 (太極數) = Σ 太玄數 over the four natal 干支 pillars."""
    p = B.four_pillars(listing)
    return sum(_gz_number(p[k]["stem_idx"], p[k]["branch_idx"]) for k in ("year", "month", "day", "hour"))


def liunian_number(ming: int, d: date) -> int:
    s, b = B.year_pillar(d)
    return ming + _gz_number(s, b)


def liuyue_number(ming: int, d: date) -> int:
    s, b = B.month_pillar(d)
    return ming + _gz_number(s, b)


def verdict(verse_no: int) -> str:
    return _VERDICT[verse_no % 3]


def make_want_long(spec, ming: int):
    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        if spec.entry_signal == "verse_fortune":          # hold only on 吉 years
            return verdict(liunian_number(ming, d)) == "吉"
        if spec.entry_signal == "avoid_inauspicious":     # flat only on 凶 years
            return verdict(liunian_number(ming, d)) != "凶"
        return False
    return want_long


def tieban_readings(listing: date, ming: int, as_of: date) -> dict[str, float | str]:
    vn = liunian_number(ming, as_of)
    v = verdict(vn)
    return {
        "tieban_regime": {"吉": "auspicious", "平": "neutral", "凶": "inauspicious"}[v],
        "ming_number": float(ming),
        "liunian_verse_no": float(vn),
        "liunian_verdict": v,
        "liunian_gua": "乾兌離震巽坎艮坤"[vn % 8],   # flavour: 流年's 八卦 by verse-no mod 8
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["tieban_regime", "ming_number", "liunian_verse_no", "liunian_verdict", "liunian_gua"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def reasoning_chain(listing: date, ming: int, as_of: date) -> list[str]:
    p = B.four_pillars(listing)
    gz = "、".join(f"{p[k]['gz']}({_gz_number(p[k]['stem_idx'], p[k]['branch_idx'])})" for k in ("year", "month", "day", "hour"))
    vn = liunian_number(ming, as_of)
    return [
        f"起數（上市日，時柱以開盤 09:30＝巳時）：四柱 {gz}，各取太玄數。",
        f"命數（太極數）＝四柱太玄數之和＝{ming}。",
        f"流年起例：命數 + 流年干支太玄數 ＝ 條文 #{vn}。",
        f"斷例：條文 #{vn} → 「{verdict(vn)}」（編號 mod 3）；流年卦象 {'乾兌離震巽坎艮坤'[vn % 8]}。",
        f"訊號：{'持有（流年得吉條）' if verdict(vn) == '吉' else '空手（流年逢凶條）' if verdict(vn) == '凶' else '依規則判定（平）'}。",
    ]
