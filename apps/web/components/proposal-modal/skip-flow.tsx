'use client';

import { SKIP_REASON_LABELS, type SkipReason } from '@hunch-it/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface SkipFlowProps {
  reason: SkipReason;
  detail: string;
  onReason: (r: SkipReason) => void;
  onDetail: (s: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}

/**
 * Skip-with-reason picker. Shown in place of the primary action row when
 * the user opens the skip flow. Reasons come from the shared SKIP_REASON
 * enum so the server-side Skip table uses the same vocabulary.
 */
export function SkipFlow({ reason, detail, onReason, onDetail, onBack, onSubmit }: SkipFlowProps) {
  return (
    <div className="rounded-2xl border border-outline-variant p-4">
      <div className="mb-2.5 font-semibold">Why are you skipping?</div>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(SKIP_REASON_LABELS) as SkipReason[]).map((r) => (
          <button
            key={r}
            onClick={() => onReason(r)}
            className={cn(
              'rounded-md border px-2.5 py-2 text-left text-sm transition-colors',
              reason === r
                ? 'border-primary bg-accent-soft text-on-surface'
                : 'border-outline-variant bg-surface-container text-on-surface hover:bg-surface-container-high',
            )}
          >
            {SKIP_REASON_LABELS[r]}
          </button>
        ))}
      </div>
      {reason === 'OTHER' && (
        <Input
          type="text"
          placeholder="Tell us why…"
          value={detail}
          onChange={(e) => onDetail(e.target.value)}
          className="mt-2.5"
        />
      )}
      <div className="mt-3 flex gap-3">
        <Button variant="ghost" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={onSubmit}>
          Submit skip
        </Button>
      </div>
    </div>
  );
}
