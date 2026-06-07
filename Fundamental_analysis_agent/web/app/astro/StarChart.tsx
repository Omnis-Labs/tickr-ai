// A circular zodiac wheel (星盤) rendered in SVG from the as-of ecliptic longitudes.
// Pure presentational — it draws exactly what the deterministic ephem chart returns.
import { PlanetPosition } from "@/lib/api";

const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const GLYPH: Record<string, string> = {
  Sun: "☉", Moon: "☽", Mercury: "☿", Venus: "♀", Mars: "♂", Jupiter: "♃", Saturn: "♄",
};
const ASPECT_COLOR: Record<string, string> = {
  conjunction: "#a1a1aa", sextile: "#34d399", trine: "#34d399", square: "#fb7185", opposition: "#fb7185",
};

// ecliptic longitude λ → screen point. Aries 0° at 9 o'clock, signs run counter-clockwise.
function pos(lon: number, r: number, cx: number, cy: number) {
  const th = ((180 - lon) * Math.PI) / 180;
  return { x: cx + r * Math.cos(th), y: cy - r * Math.sin(th) };
}

export function StarChart({ chart, aspects }: { chart: PlanetPosition[]; aspects: string[] }) {
  const S = 340, cx = S / 2, cy = S / 2;
  const rOuter = 162, rSignRing = 132, rSignGlyph = 147, rBase = 112, rIn = 90, rAspect = 84;

  // place planets, nudging inward when two sit within ~9° so glyphs don't collide
  const sorted = [...chart].sort((a, b) => a.ecliptic_lon - b.ecliptic_lon);
  const placed: Record<string, { x: number; y: number; r: number; lon: number }> = {};
  let prevLon = -99, alt = false;
  for (const p of sorted) {
    const close = Math.abs(p.ecliptic_lon - prevLon) < 9;
    const r = close ? (alt ? rIn : rBase) : rBase;
    alt = close ? !alt : false;
    const { x, y } = pos(p.ecliptic_lon, r, cx, cy);
    placed[p.body] = { x, y, r, lon: p.ecliptic_lon };
    prevLon = p.ecliptic_lon;
  }

  const lines = aspects
    .map((a) => {
      const t = a.split(/\s+/);
      const A = placed[t[0]], B = placed[t[2]];
      if (!A || !B) return null;
      const pa = pos(A.lon, rAspect, cx, cy), pb = pos(B.lon, rAspect, cx, cy);
      return { pa, pb, color: ASPECT_COLOR[t[1]] || "#52525b" };
    })
    .filter(Boolean) as { pa: { x: number; y: number }; pb: { x: number; y: number }; color: string }[];

  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[340px] mx-auto" role="img" aria-label="as-of star chart">
      <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="#3f3f46" />
      <circle cx={cx} cy={cy} r={rSignRing} fill="none" stroke="#3f3f46" />
      <circle cx={cx} cy={cy} r={rBase + 14} fill="none" stroke="#27272a" />

      {ZODIAC.map((g, i) => {
        const b0 = pos(i * 30, rOuter, cx, cy);
        const b1 = pos(i * 30, rSignRing, cx, cy);
        const gp = pos(i * 30 + 15, rSignGlyph, cx, cy);
        return (
          <g key={i}>
            <line x1={b1.x} y1={b1.y} x2={b0.x} y2={b0.y} stroke="#3f3f46" strokeWidth={0.75} />
            <text x={gp.x} y={gp.y} fontSize={13} fill="#a78bfa" textAnchor="middle" dominantBaseline="central">{g}</text>
          </g>
        );
      })}

      {lines.map((l, i) => (
        <line key={i} x1={l.pa.x} y1={l.pa.y} x2={l.pb.x} y2={l.pb.y} stroke={l.color} strokeWidth={0.75} opacity={0.55} />
      ))}

      {chart.map((p) => {
        const pl = placed[p.body];
        if (!pl) return null;
        const spoke0 = pos(p.ecliptic_lon, rSignRing, cx, cy);
        const spoke1 = pos(p.ecliptic_lon, pl.r + 9, cx, cy);
        return (
          <g key={p.body}>
            <line x1={spoke0.x} y1={spoke0.y} x2={spoke1.x} y2={spoke1.y} stroke="#3f3f46" strokeWidth={0.5} />
            <text x={pl.x} y={pl.y} fontSize={15} fill={p.retrograde ? "#fbbf24" : "#6ee7b7"} textAnchor="middle" dominantBaseline="central">{GLYPH[p.body] || "•"}</text>
            {p.retrograde && <text x={pl.x + 9} y={pl.y - 7} fontSize={7} fill="#f87171" textAnchor="middle">℞</text>}
          </g>
        );
      })}

      <circle cx={cx} cy={cy} r={2} fill="#52525b" />
    </svg>
  );
}
