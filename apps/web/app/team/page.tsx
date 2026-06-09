'use client';

import { Check, RotateCcw } from 'lucide-react';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { AI_ANALYST_CATALOG } from '@/lib/grill/analysis';
import { useAiTradingTeam } from '@/lib/grill/team-client';
import { appNarrativeCopy } from '@/lib/narrative/copy';
import { cn } from '@/lib/utils';

export default function TeamPage() {
  const { selectedIds, toggleAnalyst, resetTeam, maxTeamSize } = useAiTradingTeam();

  return (
    <>
      <TopAppBar title="Team" />

      <main className="mx-auto flex w-full max-w-md flex-col gap-[14px] px-5 pb-28 pt-4 lg:max-w-6xl lg:px-8 lg:pb-10">
        <section className="rounded-lg bg-accent p-5 text-on-accent shadow-soft">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-label-md text-primary/70">AI Trading Team</p>
              <h1 className="mt-1 text-number-lg text-primary">
                {selectedIds.length}/{maxTeamSize}
              </h1>
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
                  'rounded-lg bg-surface p-5 text-left shadow-soft transition-transform active:scale-[0.99] disabled:opacity-[0.38]',
                  selected && 'ring-1 ring-primary/70',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                      selected ? 'bg-primary text-on-primary' : 'bg-surface-container text-primary',
                    )}
                    aria-hidden="true"
                  >
                    {selected ? <Check className="h-4 w-4" /> : analyst.originTask.split(' ')[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <span className="text-title-md text-on-surface">{analyst.name}</span>
                      <span className="w-fit max-w-full rounded-full bg-surface-container px-2.5 py-1 text-label-sm text-on-surface-variant">
                        {analyst.originTask}
                      </span>
                    </span>
                    <span className="mt-2 block text-body-md leading-6 text-on-surface-variant">
                      {analyst.technique}
                    </span>
                    <span className="mt-3 block text-label-md text-primary">
                      {analyst.dataNeeds}
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
