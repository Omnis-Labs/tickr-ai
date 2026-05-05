'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * Atmospheric chartreuse light layer for the marketing hero.
 *
 * Two large soft chartreuse blooms drift across the cream canvas on
 * offset loops, translating only (no width/height/top/left animation)
 * so this stays GPU-friendly and never reflows. A faint SVG turbulence
 * grain sits on top to break up the gradient banding that otherwise
 * shows on cream backgrounds at large blur radii.
 *
 * `prefers-reduced-motion`: both blooms freeze in mid-position. The page
 * still looks deliberate, just static.
 *
 * The component is `pointer-events-none` with `-z-10` so it never
 * intercepts clicks on the hero copy or CTA above it.
 */
export function HeroLight() {
  const reduce = useReducedMotion();

  // Long-period easeInOut chosen deliberately over the design-system
  // springy ease. Atmospheric light shouldn't bounce; springy easing on
  // a 22s loop reads mechanical at the apex.
  const driftA = reduce
    ? { x: -40, y: 30 }
    : { x: [0, -120, -40, -80, 0], y: [0, 50, 30, 70, 0] };
  const driftB = reduce
    ? { x: 60, y: -20 }
    : { x: [0, 140, 80, 100, 0], y: [0, -60, -20, -40, 0] };

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* Bloom A — upper-right origin, drifts diagonally */}
      <motion.div
        className="absolute -right-[20vw] -top-[30vw] h-[90vw] w-[90vw] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(208, 233, 6, 0.55) 0%, rgba(208, 233, 6, 0.18) 35%, transparent 65%)',
          willChange: 'transform',
          filter: 'blur(40px)',
        }}
        animate={driftA}
        transition={
          reduce
            ? { duration: 0 }
            : {
                duration: 22,
                repeat: Infinity,
                ease: 'easeInOut',
                times: [0, 0.25, 0.5, 0.75, 1],
              }
        }
      />

      {/* Bloom B — lower-left origin, longer period */}
      <motion.div
        className="absolute -bottom-[25vw] -left-[15vw] h-[80vw] w-[80vw] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(232, 247, 128, 0.55) 0%, rgba(232, 247, 128, 0.18) 35%, transparent 65%)',
          willChange: 'transform',
          filter: 'blur(40px)',
        }}
        animate={driftB}
        transition={
          reduce
            ? { duration: 0 }
            : {
                duration: 30,
                repeat: Infinity,
                ease: 'easeInOut',
                times: [0, 0.25, 0.5, 0.75, 1],
              }
        }
      />

      {/* Grain — inline SVG turbulence keeps the cream from looking flat */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.07] mix-blend-multiply"
        xmlns="http://www.w3.org/2000/svg"
      >
        <filter id="hero-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#hero-grain)" />
      </svg>
    </div>
  );
}
