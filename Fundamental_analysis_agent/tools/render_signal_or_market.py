"""Render the 'idle=cash vs idle=SPY' comparison as a dumbbell SVG.

Reads signal_or_market.private.csv (run tools/signal_or_market.py first) and writes
docs/analysis/signal_or_market.private.svg — per agent, a grey dot (idle=cash alpha) joined to a
coloured dot (idle=SPY alpha), so the rightward shift = the equity-premium an agent recovers by
holding the market instead of cash when it has no signal. A vertical line at 0 marks "ties SPY".

Output is .private.svg (gitignored, like the CSV); the renderer itself is a normal reusable tool.

    python -m tools.render_signal_or_market
"""

from __future__ import annotations

import csv
import html
import statistics as st
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_CSV = _ROOT / "docs" / "analysis" / "signal_or_market.private.csv"
_OUT = _ROOT / "docs" / "analysis" / "signal_or_market.private.svg"

W, PAD_L, PAD_R = 820, 200, 64
LO, HI = -95.0, 205.0
_REAL = {"T19 anomaly", "T20 vix"}


def _x(v: float) -> float:
    return PAD_L + (max(LO, min(HI, v)) - LO) / (HI - LO) * (W - PAD_L - PAD_R)


def render() -> str:
    rows = list(csv.DictReader(_CSV.open()))
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r["agent"], []).append(r)
    agg = []
    for a, rs in by.items():
        agg.append((a, st.mean(float(r["cash_alpha_pp"]) for r in rs),
                    st.mean(float(r["spy_alpha_pp"]) for r in rs)))
    agg.sort(key=lambda t: -t[2])

    row_h, top = 26, 96
    H = top + len(agg) * row_h + 54
    e = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-sans-serif,system-ui,sans-serif">']
    e.append(f'<rect width="{W}" height="{H}" fill="#0a0a0b"/>')
    e.append(f'<text x="24" y="30" fill="#e4e4e7" font-size="15" font-weight="600">沒訊號時抱現金 → 抱大盤(SPY)：每個 agent 贏 SPY 多少 (pp)</text>')
    e.append(f'<text x="24" y="48" fill="#a1a1aa" font-size="11">灰點 = idle 抱現金 · 綠/橘點 = idle 抱 SPY · 右移 = 撿回市場溢酬 · 0 = 打平大盤 · 6 檔科技股 5 年</text>')

    # axis grid + 0 line
    for gv in (-50, 0, 50, 100, 150, 200):
        x = _x(gv)
        e.append(f'<line x1="{x}" y1="{top-8}" x2="{x}" y2="{H-34}" stroke="{"#52525b" if gv == 0 else "#1f1f23"}" stroke-width="{1.4 if gv == 0 else 1}"/>')
        e.append(f'<text x="{x}" y="{H-20}" fill="#71717a" font-size="9" text-anchor="middle">{gv:+d}</text>')
    e.append(f'<text x="{_x(0)}" y="{top-12}" fill="#a1a1aa" font-size="9" text-anchor="middle">打平 SPY</text>')

    for i, (a, cash, spy) in enumerate(agg):
        y = top + i * row_h + 12
        real = a in _REAL
        col = "#34d399" if spy > 0 else "#fb923c"
        e.append(f'<text x="{PAD_L-10}" y="{y+4}" fill="{"#e4e4e7" if real else "#a1a1aa"}" font-size="10.5" font-weight="{600 if real else 400}" text-anchor="end">{html.escape(a)}{" ★" if real else ""}</text>')
        xc, xs = _x(cash), _x(spy)
        e.append(f'<line x1="{xc}" y1="{y}" x2="{xs}" y2="{y}" stroke="#3f3f46" stroke-width="1.5"/>')
        e.append(f'<circle cx="{xc}" cy="{y}" r="3.4" fill="#71717a"/>')
        e.append(f'<circle cx="{xs}" cy="{y}" r="4.2" fill="{col}"/>')
        tx = xs + 8 if spy >= cash else xs - 8
        anc = "start" if spy >= cash else "end"
        e.append(f'<text x="{tx}" y="{y+3.5}" fill="{col}" font-size="9" text-anchor="{anc}">{spy:+.0f}</text>')

    ny = H - 6
    e.append(f'<text x="24" y="{ny}" fill="#a1a1aa" font-size="9.5">★ = 真 agent · 平均 alpha 抱現金 +29pp → 抱SPY +74pp · 11/13 抱SPY後贏大盤（多為科技選股溢酬，非擇時技巧）· T25 反而抱現金更好（它在跌時閒置）· T26/T33 鋪地板仍輸＝真反指標</text>')
    e.append('</svg>')
    return "\n".join(e)


if __name__ == "__main__":
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(render(), encoding="utf-8")
    print(f"wrote {_OUT} ({_OUT.stat().st_size} bytes)")
