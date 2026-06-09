const ITEMS = [
  'AI Analysts',
  'Grill Ideas',
  'Creator trade ideas',
  'Friend trade ideas',
  'Market watch',
  'Disciplined proposals',
  'Thesis',
  'Why now',
  'Entry trigger',
  'Position size',
  'Take profit',
  'Cut the loss',
  'Wrong if',
  'Self-custodial',
] as const;

export function CapabilitiesMarquee() {
  return (
    <section
      aria-label="Hunch It capabilities"
      className="group relative overflow-hidden border-y border-outline-variant bg-surface-container-low py-7"
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-surface-container-low to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-surface-container-low to-transparent"
        aria-hidden
      />

      <div className="animate-marquee flex w-max gap-10 whitespace-nowrap group-hover:[animation-play-state:paused]">
        {[...ITEMS, ...ITEMS].map((item, idx) => (
          <span
            key={idx}
            className="flex shrink-0 items-center gap-10 font-semibold tracking-[-0.01em] text-on-background"
            style={{ fontSize: 'clamp(20px, 2.4vw, 32px)' }}
          >
            {item}
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full bg-accent-bright"
            />
          </span>
        ))}
      </div>
    </section>
  );
}
