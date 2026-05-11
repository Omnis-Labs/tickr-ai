export interface DeskGrowthState {
  xpBalance: number;
  claimedEventIds: string[];
  analysts: AnalystRoster;
  decorations: DeskDecorations;
}

export interface DeskXpEvent {
  eventId: string;
  xp: number;
}

export type AnalystId = 'junior' | 'quant';

export type AnalystRoster = Record<AnalystId, AnalystState>;

export const DESK_DECORATION_ITEMS = {
  vendingMachine: {
    name: 'Vending Machine',
    detail: 'Keeps the trading desk stocked for long sessions',
    icon: 'local_drink',
    costXp: 10,
  },
  secondScreen: {
    name: 'Second Screen',
    detail: 'Turns the paper desk into a workstation',
    icon: 'desktop_windows',
    costXp: 15,
  },
  wallChart: {
    name: 'Wall Chart',
    detail: 'Pins market context where the room can see it',
    icon: 'insert_chart',
    costXp: 25,
  },
  deskDog: {
    name: 'Desk Dog',
    detail: 'Keeps watch near the desk',
    icon: 'pets',
    costXp: 35,
  },
} as const;

export type DecorationId = keyof typeof DESK_DECORATION_ITEMS;

export type DeskDecorations = Record<DecorationId, boolean>;

export const DESK_DECORATION_IDS = Object.keys(DESK_DECORATION_ITEMS) as DecorationId[];

export interface AnalystState {
  owned: boolean;
  level: number;
}

export const QUANT_ANALYST_COST_XP = 20;
export const MAX_ANALYST_LEVEL = 4;

export function createInitialDeskGrowthState(): DeskGrowthState {
  return {
    xpBalance: 0,
    claimedEventIds: [],
    analysts: {
      junior: { owned: true, level: 1 },
      quant: { owned: false, level: 1 },
    },
    decorations: {
      vendingMachine: false,
      secondScreen: false,
      wallChart: false,
      deskDog: false,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeLevel(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_ANALYST_LEVEL, Math.max(1, Math.floor(value)))
    : 1;
}

export function normalizeDeskGrowthState(value: unknown): DeskGrowthState {
  const defaults = createInitialDeskGrowthState();
  const record = asRecord(value);
  const analysts = asRecord(record.analysts);
  const junior = asRecord(analysts.junior);
  const quant = asRecord(analysts.quant);
  const decorations = asRecord(record.decorations);
  const normalizedDecorations = {} as DeskDecorations;

  for (const id of DESK_DECORATION_IDS) {
    normalizedDecorations[id] =
      typeof decorations[id] === 'boolean' ? decorations[id] : defaults.decorations[id];
  }

  return {
    xpBalance:
      typeof record.xpBalance === 'number' && Number.isFinite(record.xpBalance)
        ? Math.max(0, Math.floor(record.xpBalance))
        : defaults.xpBalance,
    claimedEventIds: Array.isArray(record.claimedEventIds)
      ? record.claimedEventIds.filter((id): id is string => typeof id === 'string')
      : defaults.claimedEventIds,
    analysts: {
      junior: {
        owned: true,
        level: normalizeLevel(junior.level),
      },
      quant: {
        owned: typeof quant.owned === 'boolean' ? quant.owned : defaults.analysts.quant.owned,
        level: normalizeLevel(quant.level),
      },
    },
    decorations: normalizedDecorations,
  };
}

export function awardDeskXp(
  state: DeskGrowthState,
  event: DeskXpEvent,
): { state: DeskGrowthState; awarded: boolean } {
  if (state.claimedEventIds.includes(event.eventId)) {
    return { state, awarded: false };
  }

  return {
    awarded: true,
    state: {
      ...state,
      xpBalance: state.xpBalance + event.xp,
      claimedEventIds: [...state.claimedEventIds, event.eventId],
    },
  };
}

export function buyDeskDecoration(
  state: DeskGrowthState,
  decorationId: DecorationId,
): { state: DeskGrowthState; bought: boolean } {
  const cost = DESK_DECORATION_ITEMS[decorationId].costXp;

  if (state.decorations[decorationId] || state.xpBalance < cost) {
    return { state, bought: false };
  }

  return {
    bought: true,
    state: {
      ...state,
      xpBalance: state.xpBalance - cost,
      decorations: {
        ...state.decorations,
        [decorationId]: true,
      },
    },
  };
}

export function recruitQuantAnalyst(state: DeskGrowthState): {
  state: DeskGrowthState;
  recruited: boolean;
} {
  if (state.analysts.quant.owned || state.xpBalance < QUANT_ANALYST_COST_XP) {
    return { state, recruited: false };
  }

  return {
    recruited: true,
    state: {
      ...state,
      xpBalance: state.xpBalance - QUANT_ANALYST_COST_XP,
      analysts: {
        ...state.analysts,
        quant: { ...state.analysts.quant, owned: true },
      },
    },
  };
}

export function analystLevelUpCost(level: number): number {
  return level * 20;
}

export function levelUpAnalyst(
  state: DeskGrowthState,
  analystId: AnalystId,
): { state: DeskGrowthState; leveled: boolean } {
  const analyst = state.analysts[analystId];
  const cost = analystLevelUpCost(analyst.level);

  if (!analyst.owned || analyst.level >= MAX_ANALYST_LEVEL || state.xpBalance < cost) {
    return { state, leveled: false };
  }

  return {
    leveled: true,
    state: {
      ...state,
      xpBalance: state.xpBalance - cost,
      analysts: {
        ...state.analysts,
        [analystId]: {
          ...analyst,
          level: analyst.level + 1,
        },
      },
    },
  };
}
