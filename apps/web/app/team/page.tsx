'use client';

import { Check, RotateCcw } from 'lucide-react';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { AI_ANALYST_CATALOG } from '@/lib/grill/catalog';
import { useAiTradingTeam } from '@/lib/grill/team-client';
import { appNarrativeCopy } from '@/lib/narrative/copy';
import { cn } from '@/lib/utils';

export default function TeamPage() {
  const { selectedIds, toggleAnalyst, resetTeam, maxTeamSize } = useAiTradingTeam();

  return (
    <>
      <TopAppBar title="Analysts" />

      <main className="mx-auto flex w-full max-w-md flex-col gap-[14px] px-5 pb-28 pt-4 lg:max-w-6xl lg:px-8 lg:pb-10">
        <section className="rounded-lg bg-accent p-5 text-on-accent shadow-soft">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-label-md text-primary/70">AI Analysts</p>
              <h1 className="mt-1 text-number-lg text-primary">
                {selectedIds.length}/{maxTeamSize}
              </h1>
              <p className="mt-1 text-label-md text-primary/70">Saved on this device</p>
            </div>
            <button
              type="button"
              onClick={resetTeam}
              aria-label="Reset AI Trading Team"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface/80 text-primary transition-transform active:scale-[0.97]"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="max-w-[65ch] text-body-md leading-6 text-primary/80">
            {appNarrativeCopy.teamIntro}
          </p>
        </section>

        <section className="grid gap-[14px] lg:grid-cols-2">
          {AI_ANALYST_CATALOG.map((analyst) => {
            const selected = selectedIds.includes(analyst.id);
            const disabled = !selected && selectedIds.length >= maxTeamSize;
            return (
              <button
                key={analyst.id}
                type="button"
                onClick={() => toggleAnalyst(analyst.id)}
                disabled={disabled}
                className={cn(
                  'min-h-[172px] rounded-lg bg-surface p-5 text-left shadow-soft transition-transform active:scale-[0.99] disabled:opacity-[0.38]',
                  selected && 'ring-2 ring-primary/70',
                )}
              >
                <div className="flex h-full items-start gap-4">
                  <span
                    className={cn(
                      'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
                      selected ? 'bg-primary text-on-primary' : 'bg-surface-container text-primary',
                    )}
                    aria-hidden="true"
                  >
                    {selected ? <Check className="h-4 w-4" /> : analyst.displayTag.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-title-md text-on-surface">{analyst.name}</span>
                        <span className="mt-2 block text-body-md leading-6 text-on-surface-variant">
                          {analyst.plainSummary}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-2">
                        <span className="w-fit rounded-full bg-surface-container px-2.5 py-1 text-label-sm text-on-surface-variant">
                          {analyst.displayTag}
                        </span>
                        {analyst.defaultSelected && (
                          <span className="w-fit rounded-full bg-accent-container px-2.5 py-1 text-label-sm text-on-accent-container">
                            Default
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="mt-4 flex flex-wrap gap-2">
                      <span
                        className={cn(
                          'rounded-full px-3 py-1 text-label-md',
                          selected
                            ? 'bg-primary text-on-primary'
                            : 'bg-surface-container-low text-primary',
                        )}
                      >
                        {selected ? 'Selected' : disabled ? 'Limit reached' : 'Tap to add'}
                      </span>
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </section>
      </main>
    </>
  );
}
