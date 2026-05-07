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
  onBack?: () => void;
  onSubmit?: () => void;
}

/**
 * Skip-with-reason picker. Shown in place of the primary action row when
 * the user opens the skip flow. Reasons come from the shared SKIP_REASON
 * enum so the server-side Skip table uses the same vocabulary.
 */
export function SkipFlow({ reason, detail, onReason, onDetail, onBack, onSubmit }: SkipFlowProps) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-title-md text-on-surface">Skip feedback</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            This helps tune future proposals.
          </p>
        </div>
        <span className="material-symbols-outlined text-[22px] text-icon-muted">feedback</span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {(Object.keys(SKIP_REASON_LABELS) as SkipReason[]).map((r) => (
          <button
            type="button"
            key={r}
            onClick={() => onReason(r)}
            className={cn(
              'flex min-h-11 items-center justify-between rounded-full border px-4 py-2 text-left text-body-sm transition-colors',
              reason === r
                ? 'border-primary bg-accent-soft text-on-surface shadow-micro'
                : 'border-outline-variant bg-surface-container text-on-surface hover:bg-surface-container-high',
            )}
          >
            <span>{SKIP_REASON_LABELS[r]}</span>
            {reason === r && (
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
            )}
          </button>
        ))}
      </div>
      {reason === 'OTHER' && (
        <Input
          type="text"
          placeholder="Tell us why"
          value={detail}
          onChange={(e) => onDetail(e.target.value)}
          className="mt-3"
        />
      )}
      {onBack && onSubmit && (
        <div className="mt-4 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onBack}>
            Back
          </Button>
          <Button className="flex-1" onClick={onSubmit}>
            Submit skip
          </Button>
        </div>
      )}
    </div>
  );
}
