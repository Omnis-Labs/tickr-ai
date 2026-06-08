// 七政四餘 circular zodiac wheel — 七政 (日月水金火木土) + 四餘 (羅計孛炁) placed by
// ecliptic longitude on the 黃道十二宮. Pure presentational over the engine's data.
import { QizhengStar } from "@/lib/api";

const SIGNS_ZH = ["白羊", "金牛", "雙子", "巨蟹", "獅子", "處女", "天秤", "天蠍", "人馬", "摩羯", "寶瓶", "雙魚"];
const SIGNS_EN = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const ABBR: Record<string, string> = { 羅睺: "羅", 計都: "計", 月孛: "孛", 紫炁: "炁" };
// 七政四餘 fortune colouring: 吉曜 金木 green, 凶曜 火土羅計 red/amber, the rest neutral
const COLOR: Record<string, string> = {
  日: "#fbbf24", 月: "#d4d4d8", 水: "#60a5fa", 金: "#34d399", 火: "#f87171", 木: "#34d399",
  土: "#fb923c", 羅: "#f87171", 計: "#f87171", 孛: "#c4b5fd", 炁: "#c4b5fd",
};

function pos(lon: number, r: number, cx: number, cy: number) {
  const th = ((180 - lon) * Math.PI) / 180;   // Aries 0° at 9 o'clock, counter-clockwise
  return { x: cx + r * Math.cos(th), y: cy - r * Math.sin(th) };
}

export function QizhengChart({ seven, siyu, mingZhuSign }: { seven: QizhengStar[]; siyu: QizhengStar[]; mingZhuSign: string }) {
  const S = 340, cx = S / 2, cy = S / 2;
  const rOuter = 162, rRing = 132, rGlyph = 147, rBase = 112, rIn = 90;
  const mingIdx = SIGNS_EN.indexOf(mingZhuSign);

  const bodies = [...seven, ...siyu].map((b) => ({ label: ABBR[b.name] || b.name, lon: b.ecliptic_lon }));
  const sorted = [...bodies].sort((a, b) => a.lon - b.lon);
  const placed: { label: string; lon: number; r: number }[] = [];
  let prev = -99, alt = false;
  for (const b of sorted) {
    const close = Math.abs(b.lon - prev) < 9;
    placed.push({ ...b, r: close ? (alt ? rIn : rBase) : rBase });
    alt = close ? !alt : false; prev = b.lon;
  }

  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[340px] mx-auto" role="img" aria-label="七政四餘 星盤">
      {/* 命主 sector highlight */}
      {mingIdx >= 0 && (() => {
        const a0 = pos(mingIdx * 30, rOuter, cx, cy), a1 = pos((mingIdx + 1) * 30, rOuter, cx, cy);
        const m0 = pos(mingIdx * 30, rRing, cx, cy), m1 = pos((mingIdx + 1) * 30, rRing, cx, cy);
        return <path d={`M${m0.x} ${m0.y} L${a0.x} ${a0.y} A${rOuter} ${rOuter} 0 0 0 ${a1.x} ${a1.y} L${m1.x} ${m1.y} A${rRing} ${rRing} 0 0 1 ${m0.x} ${m0.y} Z`} fill="#a16207" opacity={0.18} />;
      })()}
      <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="#3f3f46" />
      <circle cx={cx} cy={cy} r={rRing} fill="none" stroke="#3f3f46" />
      <circle cx={cx} cy={cy} r={rBase + 14} fill="none" stroke="#27272a" />
      {SIGNS_ZH.map((nm, i) => {
        const b0 = pos(i * 30, rOuter, cx, cy), b1 = pos(i * 30, rRing, cx, cy);
        const gp = pos(i * 30 + 15, rGlyph, cx, cy);
        return (
          <g key={i}>
            <line x1={b1.x} y1={b1.y} x2={b0.x} y2={b0.y} stroke="#3f3f46" strokeWidth={0.75} />
            <text x={gp.x} y={gp.y} fontSize={10} fill={i === mingIdx ? "#fbbf24" : "#a78bfa"} textAnchor="middle" dominantBaseline="central">{nm}</text>
          </g>
        );
      })}
      {placed.map((b, i) => {
        const p = pos(b.lon, b.r, cx, cy);
        const s0 = pos(b.lon, rRing, cx, cy), s1 = pos(b.lon, b.r + 9, cx, cy);
        return (
          <g key={i}>
            <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} stroke="#3f3f46" strokeWidth={0.5} />
            <text x={p.x} y={p.y} fontSize={14} fill={COLOR[b.label] || "#e4e4e7"} textAnchor="middle" dominantBaseline="central">{b.label}</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={2} fill="#52525b" />
    </svg>
  );
}
