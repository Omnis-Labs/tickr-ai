"""Render the PSR→DSR collapse as a committed SVG for the one-pager / README.

Reads shared/reports/deflated_sharpe.json (no recompute) and writes
docs/analysis/deflated_sharpe.svg — per agent, two bars on a 0..1 probability scale:
the Probabilistic Sharpe Ratio (PSR vs 0 — "is the Sharpe even positive?") in emerald,
and the Deflated Sharpe Ratio (DSR — "does it beat the best of N=trials flukes?") in
amber. A gold line marks the 0.95 significance bar. The visual point: PSR bars look
healthy, but every DSR bar collapses far short of 0.95 — the multiple-testing haircut.

    python -m tools.render_deflated_sharpe
"""

from __future__ import annotations

import html
import json
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_JSON = _ROOT / "shared" / "reports" / "deflated_sharpe.json"
_OUT = _ROOT / "docs" / "analysis" / "deflated_sharpe.svg"

W = 760
PAD = 20
BAR_X0 = 188
BAR_X1 = W - 70
BAR_W = BAR_X1 - BAR_X0


def _x(v: float) -> float:
    return BAR_X0 + max(0.0, min(1.0, v)) * BAR_W


def render() -> str:
    d = json.loads(_JSON.read_text(encoding="utf-8"))
    agents = d.get("agents", [])
    inp = d.get("inputs", {})
    emax = d.get("expected_max_sharpe_ann", "?")
    n_trials = inp.get("n_trials", "?")

    row_h = 44
    top = 108
    H = top + len(agents) * row_h + 40
    thr_x = _x(0.95)
    e: list[str] = []
    e.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-sans-serif,system-ui,sans-serif">')
    e.append(f'<rect width="{W}" height="{H}" fill="#0a0a0b"/>')
    e.append(f'<text x="{PAD}" y="28" fill="#e4e4e7" font-size="15" font-weight="600">The multiple-testing haircut — PSR looks healthy, Deflated Sharpe collapses</text>')
    e.append(f'<text x="{PAD}" y="46" fill="#a1a1aa" font-size="11">Deflated Sharpe Ratio (Bailey &amp; López de Prado, 2014) · expected best Sharpe by luck over N={n_trials} trials = {emax}</text>')
    e.append(f'<text x="{PAD}" y="62" fill="#a1a1aa" font-size="11">PSR vs 0 = P(true Sharpe &gt; 0). DSR = P(Sharpe beats the best-of-{n_trials} fluke). An edge is credible only at DSR &gt; 0.95.</text>')

    # 0..1 axis gridlines
    for gv in (0.0, 0.25, 0.5, 0.75, 1.0):
        x = _x(gv)
        e.append(f'<line x1="{x}" y1="{top-6}" x2="{x}" y2="{H-46}" stroke="#1f1f23" stroke-width="1"/>')
        e.append(f'<text x="{x}" y="{H-34}" fill="#71717a" font-size="9" text-anchor="middle">{gv:.2f}</text>')
    # 0.95 significance line
    e.append(f'<line x1="{thr_x}" y1="{top-6}" x2="{thr_x}" y2="{H-46}" stroke="#fbbf24" stroke-width="1.3" stroke-dasharray="4 3"/>')
    e.append(f'<text x="{thr_x}" y="{top-12}" fill="#fbbf24" font-size="9.5" text-anchor="middle">significant ≥ 0.95</text>')

    for i, a in enumerate(agents):
        y = top + i * row_h
        name = html.escape(str(a.get("agent", "?")))
        sr = a.get("sharpe_ann", 0.0)
        psr = a.get("psr_vs_zero", 0.0)
        dsr = a.get("dsr", 0.0)
        e.append(f'<text x="{PAD}" y="{y+15}" fill="#e4e4e7" font-size="11" font-weight="600">{name}</text>')
        e.append(f'<text x="{PAD}" y="{y+30}" fill="#71717a" font-size="9">Sharpe {sr:.2f}</text>')
        # background tracks
        e.append(f'<rect x="{BAR_X0}" y="{y+2}" width="{BAR_W}" height="12" fill="#18181b"/>')
        e.append(f'<rect x="{BAR_X0}" y="{y+18}" width="{BAR_W}" height="12" fill="#18181b"/>')
        # PSR bar (emerald)
        e.append(f'<rect x="{BAR_X0}" y="{y+2}" width="{max(0.0,min(1.0,psr))*BAR_W:.1f}" height="12" fill="#34d399"/>')
        e.append(f'<text x="{BAR_X0-6}" y="{y+11}" fill="#34d399" font-size="8.5" text-anchor="end">PSR</text>')
        e.append(f'<text x="{_x(psr)+5}" y="{y+11}" fill="#d4d4d8" font-size="9">{psr:.2f}</text>')
        # DSR bar (amber) — clamp a hair of width so a 0.00 bar is still visible as a sliver
        e.append(f'<rect x="{BAR_X0}" y="{y+18}" width="{max(0.4,max(0.0,min(1.0,dsr))*BAR_W):.1f}" height="12" fill="#fb923c"/>')
        e.append(f'<text x="{BAR_X0-6}" y="{y+27}" fill="#fb923c" font-size="8.5" text-anchor="end">DSR</text>')
        e.append(f'<text x="{_x(dsr)+5}" y="{y+27}" fill="#d4d4d8" font-size="9">{dsr:.2f}</text>')

    sig = d.get("n_agents_significant", 0)
    e.append(f'<text x="{PAD}" y="{H-14}" fill="#a1a1aa" font-size="10">{sig}/{len(agents)} agents clear DSR &gt; 0.95 on median single-name Sharpe — the bar is the best-of-{n_trials} fluke, not the median one.</text>')
    e.append('</svg>')
    return "\n".join(e)


if __name__ == "__main__":
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(render(), encoding="utf-8")
    print(f"wrote {_OUT} ({_OUT.stat().st_size} bytes)")
