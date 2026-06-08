// South-Indian rāśi chart: a fixed 4×4 grid of signs (Pisces top-left, clockwise),
// grahas placed into their sidereal rāśi. Pure presentational over the engine's data.
import { Graha } from "@/lib/api";

// rāśi name → [gridRow, gridColumn] (1-indexed); 12 outer cells, centre 2×2 = info.
const POS: Record<string, [number, number]> = {
  Meena: [1, 1], Mesha: [1, 2], Vrishabha: [1, 3], Mithuna: [1, 4],
  Kumbha: [2, 1], Karka: [2, 4],
  Makara: [3, 1], Simha: [3, 4],
  Dhanu: [4, 1], Vrischika: [4, 2], Tula: [4, 3], Kanya: [4, 4],
};
const ABBR: Record<string, string> = {
  Sun: "Su", Moon: "Mo", Mars: "Ma", Mercury: "Me", Jupiter: "Ju",
  Venus: "Ve", Saturn: "Sa", Rahu: "Ra", Ketu: "Ke",
};
const BENEFIC = new Set(["Jupiter", "Venus", "Mercury", "Moon"]);

export function RashiChart({ grahas, moonRashi, dashaLord }: { grahas: Graha[]; moonRashi: string; dashaLord: string }) {
  const byRashi: Record<string, Graha[]> = {};
  grahas.forEach((g) => { (byRashi[g.rashi] = byRashi[g.rashi] || []).push(g); });
  return (
    <div className="grid gap-px bg-zinc-800 border border-zinc-800 rounded overflow-hidden"
      style={{ gridTemplateColumns: "repeat(4,1fr)", gridTemplateRows: "repeat(4,minmax(58px,1fr))" }}>
      {Object.entries(POS).map(([rashi, [r, c]]) => {
        const here = byRashi[rashi] || [];
        const isMoon = rashi === moonRashi;
        return (
          <div key={rashi} style={{ gridRow: r, gridColumn: c }}
            className={`p-1.5 ${isMoon ? "bg-blue-950/40" : "bg-zinc-950/60"}`}>
            <div className="text-[9px] text-zinc-600">{rashi}{isMoon ? " ·☾" : ""}</div>
            <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
              {here.map((g) => (
                <span key={g.name}
                  className={`text-[11px] ${g.name === dashaLord ? "font-bold underline" : ""} ${BENEFIC.has(g.name) ? "text-emerald-400" : "text-amber-400"}`}
                  title={`${g.name} ${g.sidereal_lon.toFixed(1)}°`}>
                  {ABBR[g.name] || g.name.slice(0, 2)}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{ gridRow: "2 / span 2", gridColumn: "2 / span 2" }}
        className="bg-zinc-900 flex flex-col items-center justify-center text-center gap-1 p-2">
        <div className="text-xs text-zinc-400">Rāśi chart (sidereal)</div>
        <div className="text-[11px] text-zinc-500">Moon ☾ in <span className="text-blue-300">{moonRashi}</span></div>
        <div className="text-[11px] text-zinc-500">Mahādaśā <span className="text-zinc-200 underline">{dashaLord}</span></div>
        <div className="text-[9px] text-zinc-600">benefic <span className="text-emerald-400">●</span> · malefic <span className="text-amber-400">●</span> · daśā lord underlined</div>
      </div>
    </div>
  );
}
