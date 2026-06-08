'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AI_ANALYST_CATALOG,
  DEFAULT_AI_TRADING_TEAM_IDS,
  MAX_AI_TRADING_TEAM_SIZE,
} from './analysis';

const STORAGE_KEY = 'hunch.aiTradingTeam.v1';
const analystIds = new Set(AI_ANALYST_CATALOG.map((analyst) => analyst.id));

function sanitize(ids: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (!analystIds.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_AI_TRADING_TEAM_SIZE) break;
  }
  return out.length > 0 ? out : [...DEFAULT_AI_TRADING_TEAM_IDS];
}

function readStoredTeam(): string[] {
  if (typeof window === 'undefined') return [...DEFAULT_AI_TRADING_TEAM_IDS];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    return sanitize(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : null,
    );
  } catch {
    return [...DEFAULT_AI_TRADING_TEAM_IDS];
  }
}

export function useAiTradingTeam() {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [...DEFAULT_AI_TRADING_TEAM_IDS]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSelectedIds(readStoredTeam());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
  }, [loaded, selectedIds]);

  const selectedAnalysts = useMemo(
    () => AI_ANALYST_CATALOG.filter((analyst) => selectedIds.includes(analyst.id)),
    [selectedIds],
  );

  function toggleAnalyst(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        const next = current.filter((item) => item !== id);
        return next.length > 0 ? next : current;
      }
      if (current.length >= MAX_AI_TRADING_TEAM_SIZE) return current;
      return [...current, id];
    });
  }

  function resetTeam() {
    setSelectedIds([...DEFAULT_AI_TRADING_TEAM_IDS]);
  }

  return {
    selectedIds,
    selectedAnalysts,
    toggleAnalyst,
    resetTeam,
    maxTeamSize: MAX_AI_TRADING_TEAM_SIZE,
  };
}
