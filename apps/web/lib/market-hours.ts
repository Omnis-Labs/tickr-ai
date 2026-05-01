// Client-side mirror of ws-server/src/pyth/index.ts isUsMarketOpen.
// We keep them duplicated rather than importing across the package
// boundary because (a) it's 30 lines, (b) packages/shared can't pull in
// node-specific types and we want this tree-shakeable for the bundle.
//
// The signal generator uses Pyth publishTime freshness as the real gate;
// this one is purely UX — desk shows "market closed, next open in N
// minutes" so users understand why proposals are sparse.

export interface MarketStatus {
  /** True iff America/New_York wall clock is Mon–Fri 09:30–16:00. */
  isOpen: boolean;
  /** Next regular open in absolute UTC ms. Always populated. */
  nextOpenAt: number;
  /** Minutes from `at` to the next open. 0 if currently open. */
  minutesUntilOpen: number;
}

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

function nyParts(at: Date): { weekday: string; hour: number; minute: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: get('weekday'),
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour') === '24' ? '0' : get('hour')),
    minute: Number(get('minute')),
  };
}

export function getMarketStatus(at: Date = new Date()): MarketStatus {
  const p = nyParts(at);
  const weekend = p.weekday === 'Sat' || p.weekday === 'Sun';
  const minutes = p.hour * 60 + p.minute;
  const isOpen = !weekend && minutes >= OPEN_MIN && minutes < CLOSE_MIN;

  if (isOpen) {
    return { isOpen: true, nextOpenAt: at.getTime(), minutesUntilOpen: 0 };
  }

  // Walk forward day-by-day from `at` until we land on a weekday with the
  // 09:30 mark in the future. Done in NY wall clock so DST doesn't drift.
  let probe = new Date(at.getTime());
  for (let i = 0; i < 7; i++) {
    const pp = nyParts(probe);
    const ppMinutes = pp.hour * 60 + pp.minute;
    const isWeekday = pp.weekday !== 'Sat' && pp.weekday !== 'Sun';
    const beforeOpen = isWeekday && ppMinutes < OPEN_MIN && i === 0; // only "today" can use beforeOpen
    if (isWeekday && (beforeOpen || i > 0)) {
      // Construct a Date at NY 09:30 of pp's date.
      const y = pp.year;
      const m = pp.month;
      const d = pp.day;
      // Build via UTC then correct for offset by re-formatting.
      const candidateUtc = Date.UTC(y, m - 1, d, OPEN_MIN / 60, OPEN_MIN % 60);
      // Determine NY offset for that candidate moment.
      const offsetParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        timeZoneName: 'shortOffset',
      }).formatToParts(new Date(candidateUtc));
      const tz = offsetParts.find((x) => x.type === 'timeZoneName')?.value ?? 'GMT-5';
      const m2 = /GMT([+-]\d+)/.exec(tz);
      const offsetHours = m2 ? Number(m2[1]) : -5;
      const adjusted = candidateUtc - offsetHours * 3600 * 1000;
      if (adjusted > at.getTime()) {
        return {
          isOpen: false,
          nextOpenAt: adjusted,
          minutesUntilOpen: Math.ceil((adjusted - at.getTime()) / 60000),
        };
      }
    }
    probe = new Date(probe.getTime() + 24 * 3600 * 1000);
  }

  // Fallback (should never hit): treat as open in 1h.
  return {
    isOpen: false,
    nextOpenAt: at.getTime() + 3600 * 1000,
    minutesUntilOpen: 60,
  };
}

export function formatMinutesUntil(minutes: number): string {
  if (minutes <= 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}
