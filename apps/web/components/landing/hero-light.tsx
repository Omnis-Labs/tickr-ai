'use client';

import { MeshGradient } from '@paper-design/shaders-react';
import { useReducedMotion } from 'framer-motion';

/**
 * Atmospheric WebGL mesh-gradient for the marketing hero.
 *
 * Uses paper-design's MeshGradient fragment shader to produce flowing
 * silk-like fluid motion. The internal turbulence (color folding,
 * swirl, organic distortion) is what makes this read as alive instead
 * of "translated gradient image"; CSS transforms can't do this.
 *
 * Palette: cream base + soft beige tonal sibling + acid chartreuse as
 * specular accent. Chartreuse stays a minority colour (one of four
 * stops) so the shader breathes warm cream most of the time and the
 * acid only blooms through where the mesh folds.
 *
 * Performance: minPixelRatio capped at 1.5 to keep mid-tier mobile
 * GPUs at 60fps. `prefers-reduced-motion` flips speed to 0; the shader
 * still renders a static frame so the hero keeps its atmosphere
 * instead of going pure flat.
 *
 * The container is `pointer-events-none` with `-z-10` so it never
 * intercepts hero copy or CTA. A bottom-edge mask fades the shader
 * into the cream canvas so the section seam is not a hard rectangle.
 */
export function HeroLight() {
  const reduce = useReducedMotion();

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      style={{
        maskImage:
          'linear-gradient(to bottom, black 0%, black 65%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, black 0%, black 65%, transparent 100%)',
      }}
    >
      <MeshGradient
        colors={['#F2EFE8', '#D7F20A', '#F5C896', '#E5E1D5']}
        speed={reduce ? 0 : 0.55}
        distortion={0.9}
        swirl={0.75}
        grainMixer={0.3}
        grainOverlay={0.18}
        minPixelRatio={1.5}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
    </div>
  );
}
