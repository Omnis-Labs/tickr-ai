"""Render the divination-control null band as a committed SVG for the README.

Reads shared/reports/divination_null_band.json (no recompute) and writes
docs/analysis/divination_null_band.svg — a Sharpe number-line with the pooled
p50→p95 control band shaded, percentile ticks, the real agents plotted as dots
(green = clears the control p95, red = inside the band), and per-system max-Sharpe
bars. GitHub renders committed SVGs referenced via `![](…svg)`.

    python -m tools.render_null_band
"""

from __future__ import annotations

import html
import json
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_JSON = _ROOT / "shared" / "reports" / "divination_null_band.json"
_OUT = _ROOT / "docs" / "analysis" / "divination_null_band.svg"

LO, HI = -1.0, 2.2
W, PAD = 760, 90
AX = W - 2 * PAD          # axis width


def _x(s: float) -> float:
    return PAD + (max(LO, min(HI, s)) - LO) / (HI - LO) * AX


def render() -> str:
    d = json.loads(_JSON.read_text(encoding="utf-8"))
    p = d.get("pooled_sharpe", {})
    p95 = d.get("sharpe_p95_threshold", p.get("p95", 0))
    systems = sorted(d.get("by_system_max_sharpe", {}).items(), key=lambda kv: -kv[1])
    overlay = list(d.get("real_agent_overlay", {}).items())

    bars_top = 150
    H = bars_top + len(systems) * 20 + 50
    e: list[str] = []
    e.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-sans-serif,system-ui,sans-serif">')
    e.append(f'<rect width="{W}" height="{H}" fill="#0a0a0b"/>')
    e.append(f'<text x="{PAD}" y="28" fill="#e4e4e7" font-size="15" font-weight="600">Divination-control null band — real agents vs 11 placebo systems</text>')
    e.append(f'<text x="{PAD}" y="46" fill="#a1a1aa" font-size="11">{d.get("n_draws","?")} draws · {len(d.get("panel",[]))} names · a real agent must clear the control p95 ({p95}) to be distinguishable from divination</text>')

    ay = 96  # axis y
    # axis line + end labels
    e.append(f'<line x1="{_x(LO)}" y1="{ay}" x2="{_x(HI)}" y2="{ay}" stroke="#3f3f46" stroke-width="1"/>')
    for gv in (-1.0, 0.0, 1.0, 2.0):
        e.append(f'<line x1="{_x(gv)}" y1="{ay-3}" x2="{_x(gv)}" y2="{ay+3}" stroke="#52525b"/>')
        e.append(f'<text x="{_x(gv)}" y="{ay+18}" fill="#71717a" font-size="9" text-anchor="middle">Sharpe {gv:.0f}</text>')
    # shaded p50→p95 band
    if "p50" in p:
        e.append(f'<rect x="{_x(p["p50"])}" y="{ay-9}" width="{_x(p95)-_x(p["p50"])}" height="18" fill="#581c8740" stroke="#7e22ce" stroke-width="1"/>')
    # percentile ticks (above the axis)
    ticks = [("p50", p.get("p50"), "#a1a1aa"), ("p90", p.get("p90"), "#a1a1aa"),
             ("p95", p95, "#fbbf24"), ("p99", p.get("p99"), "#a1a1aa"), ("max", p.get("max"), "#f87171")]
    for k, v, col in ticks:
        if not isinstance(v, (int, float)):
            continue
        x = _x(v)
        e.append(f'<line x1="{x}" y1="{ay-22}" x2="{x}" y2="{ay}" stroke="{col}" stroke-width="1.5"/>')
        e.append(f'<text x="{x}" y="{ay-26}" fill="{col}" font-size="9" text-anchor="middle">{k} {v:.2f}</text>')
    # real-agent dots (below axis), alternating height to avoid overlap
    for i, (name, o) in enumerate(overlay):
        x = _x(o["best_sharpe"]); col = "#34d399" if o.get("clears_control_p95") else "#f87171"
        yy = ay + 30 + (i % 3) * 18
        e.append(f'<line x1="{x}" y1="{ay}" x2="{x}" y2="{yy-6}" stroke="{col}" stroke-width="0.6" stroke-dasharray="2 2"/>')
        e.append(f'<circle cx="{x}" cy="{yy}" r="4" fill="{col}"/>')
        e.append(f'<text x="{x+7}" y="{yy+3}" fill="{col}" font-size="9.5">{html.escape(name)} {o["best_sharpe"]:.2f}</text>')

    # legend
    ly = bars_top - 18
    e.append(f'<circle cx="{PAD+4}" cy="{ly}" r="4" fill="#34d399"/><text x="{PAD+14}" y="{ly+3}" fill="#a1a1aa" font-size="9.5">clears control p95</text>')
    e.append(f'<circle cx="{PAD+150}" cy="{ly}" r="4" fill="#f87171"/><text x="{PAD+160}" y="{ly+3}" fill="#a1a1aa" font-size="9.5">inside the band (≈ placebo)</text>')
    e.append(f'<rect x="{PAD+330}" y="{ly-5}" width="14" height="10" fill="#581c8740" stroke="#7e22ce"/><text x="{PAD+350}" y="{ly+3}" fill="#a1a1aa" font-size="9.5">p50→p95 control band</text>')

    # per-system max-Sharpe bars
    e.append(f'<text x="{PAD}" y="{bars_top+8}" fill="#d4d4d8" font-size="11" font-weight="600">Max Sharpe by divination system (worthless timing on the best name in the panel)</text>')
    bw = AX - 120
    for i, (s, v) in enumerate(systems):
        y = bars_top + 24 + i * 20
        e.append(f'<text x="{PAD}" y="{y+9}" fill="#a1a1aa" font-size="10">{html.escape(s)}</text>')
        e.append(f'<rect x="{PAD+130}" y="{y}" width="{bw}" height="11" fill="#18181b"/>')
        e.append(f'<rect x="{PAD+130}" y="{y}" width="{max(0,min(1,v/2.0))*bw:.1f}" height="11" fill="#7e22ce"/>')
        e.append(f'<text x="{PAD+130+bw+6}" y="{y+9}" fill="#d4d4d8" font-size="10">{v:.2f}</text>')
    e.append('</svg>')
    return "\n".join(e)


if __name__ == "__main__":
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(render(), encoding="utf-8")
    print(f"wrote {_OUT} ({_OUT.stat().st_size} bytes)")
