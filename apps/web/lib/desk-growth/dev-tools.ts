import {
  createInitialDeskGrowthState,
  normalizeDeskGrowthState,
  type DeskGrowthState,
} from './state';
import type { DeskGrowthFeedback } from '../notifications/registry';

export const ROOM_DEV_TOOLS_XP_GRANT = 500;

export function resetDeskGrowthDevToolsState(): DeskGrowthState {
  return createInitialDeskGrowthState();
}

export function addDeskGrowthDevToolsXp(state: DeskGrowthState): DeskGrowthState {
  const current = normalizeDeskGrowthState(state);
  return {
    ...current,
    xpBalance: current.xpBalance + ROOM_DEV_TOOLS_XP_GRANT,
  };
}

export function createDeskGrowthDevToolsXpFeedback(): DeskGrowthFeedback {
  return {
    kind: 'xp-awarded',
    xp: ROOM_DEV_TOOLS_XP_GRANT,
    reason: 'dev-tools',
  };
}
