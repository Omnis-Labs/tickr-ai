'use client';

import confetti from 'canvas-confetti';
import type { DeskGrowthCelebrationOrigin } from './use-desk-growth';

type ConfettiOptions = NonNullable<Parameters<typeof confetti>[0]>;

const CONFETTI_COLORS = ['#D0E906', '#BDEDF4', '#F5C896', '#20BFC6', '#FF745D'];

function normalizedConfettiOrigin(
  origin: DeskGrowthCelebrationOrigin,
): NonNullable<ConfettiOptions['origin']> {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);

  return {
    x: Math.min(1, Math.max(0, origin.x / width)),
    y: Math.min(1, Math.max(0, origin.y / height)),
  };
}

export function sprayDeskGrowthConfetti(origin: DeskGrowthCelebrationOrigin) {
  const common: ConfettiOptions = {
    colors: CONFETTI_COLORS,
    disableForReducedMotion: true,
    origin: normalizedConfettiOrigin(origin),
    zIndex: 100,
  };

  void confetti({
    ...common,
    angle: 90,
    decay: 0.91,
    gravity: 0.95,
    particleCount: 90,
    scalar: 0.82,
    spread: 76,
    startVelocity: 42,
    ticks: 180,
  });

  void confetti({
    ...common,
    angle: 90,
    decay: 0.94,
    gravity: 1.18,
    particleCount: 36,
    scalar: 0.62,
    shapes: ['circle', 'square'],
    spread: 118,
    startVelocity: 25,
    ticks: 140,
  });
}
