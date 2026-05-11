'use client';

import {
  createInitialDeskGrowthState,
  normalizeDeskGrowthState,
  type DeskGrowthState,
} from './state';

export const DESK_GROWTH_STORAGE_KEY = 'hunch:desk-growth:v1';
export const DESK_GROWTH_STORAGE_EVENT = 'hunch:desk-growth:update';

export function readDeskGrowthState(): DeskGrowthState {
  if (typeof window === 'undefined') return createInitialDeskGrowthState();

  try {
    const raw = window.localStorage.getItem(DESK_GROWTH_STORAGE_KEY);
    return normalizeDeskGrowthState(raw ? JSON.parse(raw) : null);
  } catch {
    return createInitialDeskGrowthState();
  }
}

export function writeDeskGrowthState(state: DeskGrowthState) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(DESK_GROWTH_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(DESK_GROWTH_STORAGE_EVENT));
}
