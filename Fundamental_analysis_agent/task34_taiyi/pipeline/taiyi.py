"""太乙神數 (Taiyi Shenshu) deterministic engine. Offline, lookahead-free. ⚠️ PLACEBO.

The third 式 — historically used for 國運/軍國 prognostication. The authentic system
walks 太乙積年 through the 十六神/九宮 with 主算 (host) vs 客算 (guest) and a web of 格局
(囚/格/迫/關); this is a SIMPLIFIED deterministic version: a 太乙積年 from a fixed 上元,
the 太乙宮 it occupies, and a 主算/客算 pair whose comparison (主客勝負) drives the signal:
  主算 ≥ 客算  →  主勝 (host wins) → favourable
  主算 <  客算 →  客勝 (guest wins) → unfavourable

Reuses Task 27's 干支 calendar for the 流年.
"""

from __future__ import annotations

from datetime import date

from task27_bazi.pipeline import bazi as B

# 太乙上元積年 base (traditional order of magnitude; exact 上元 varies by school — simplified).
_SHANGYUAN = 1936557
PALACES = ["乾", "離", "艮", "震", "巽", "坤", "兌", "坎"]   # 八宮 (太乙不入中宮)


def accumulated_years(d: date) -> int:
    return _SHANGYUAN + B._solar_year(d)


def taiyi_palace(d: date) -> str:
    """太乙每 24 年遷一宮，循八宮 (不入中五)."""
    return PALACES[(accumulated_years(d) // 24) % 8]


def host_guest(d: date) -> tuple[int, int]:
    """主算 (host) / 客算 (guest) — simplified deterministic counts from 積年 + 流年."""
    acc = accumulated_years(d)
    ly = B._solar_year(d)
    host = (acc + ly) % 360
    guest = (acc * 3 + ly * 2 + 30) % 360
    return host, guest


def host_wins(d: date) -> bool:
    h, g = host_guest(d)
    return h >= g


def make_want_long(spec):
    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        if spec.entry_signal == "host_prevails":
            return host_wins(d)
        if spec.entry_signal == "avoid_guest_win":
            return host_wins(d)
        return False
    return want_long


def taiyi_readings(d: date) -> dict[str, float | str]:
    h, g = host_guest(d)
    return {
        "taiyi_regime": "host_prevails" if h >= g else "guest_prevails",
        "accumulated_years": float(accumulated_years(d)),
        "taiyi_palace": taiyi_palace(d) + "宮",
        "host_count": float(h),
        "guest_count": float(g),
        "verdict": "主勝" if h >= g else "客勝",
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["taiyi_regime", "accumulated_years", "taiyi_palace", "host_count", "guest_count", "verdict"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def reasoning_chain(d_natal: date, as_of: date) -> list[str]:
    r = taiyi_readings(as_of)
    return [
        f"積年（上市 {d_natal.isoformat()} 命盤；流年 {B._solar_year(as_of)} 推算，簡化上元）。",
        f"太乙積年 ＝ {int(r['accumulated_years'])}，太乙臨 {r['taiyi_palace']}（24 年遷一宮）。",
        f"主算 ＝ {int(r['host_count'])}、客算 ＝ {int(r['guest_count'])} → 斷「{r['verdict']}」。",
        f"訊號：{'持有（主勝，利己）' if r['taiyi_regime'] == 'host_prevails' else '空手（客勝，不利己）'}。",
    ]
