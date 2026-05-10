'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ProposalFormProps {
  size: number;
  trigger: number;
  tp: number;
  sl: number;
  onSize: (v: number) => void;
  onTrigger: (v: number) => void;
  onTp: (v: number) => void;
  onSl: (v: number) => void;
}

/**
 * Editable trade-parameters block: size / trigger / TP / SL with inline
 * percentage hints and an R/R footer line. Pure controlled inputs.
 */
export function ProposalForm({ size, trigger, tp, sl, onSize, onTrigger, onTp, onSl }: ProposalFormProps) {
  const sizeWarning =
    size > 500 ? 'Above your $500 max trade size. Proceed with caution.' : null;
  const tpPctRaw = trigger > 0 ? ((tp - trigger) / trigger) * 100 : 0;
  const slPctRaw = trigger > 0 ? ((sl - trigger) / trigger) * 100 : 0;
  const tpPct = Number.isFinite(tpPctRaw) ? tpPctRaw : 0;
  const slPct = Number.isFinite(slPctRaw) ? slPctRaw : 0;
  const rr = sl > 0 && trigger > sl && tp > trigger ? (tp - trigger) / (trigger - sl) : null;

  return (
    <>
      <div className="grid grid-cols-1 gap-3">
        <NumField
          label="Size"
          hint="USDC committed"
          value={size}
          onChange={onSize}
          warning={sizeWarning}
          step={10}
        />
        <NumField
          label="Trigger"
          hint="Entry price"
          value={trigger}
          onChange={onTrigger}
          step={0.5}
        />
        <NumField
          label="Take profit"
          hint={tp > trigger ? `+${tpPct.toFixed(1)}% from trigger` : 'Target exit'}
          value={tp}
          onChange={onTp}
          step={0.5}
          tone="positive"
        />
        <NumField
          label="Stop loss"
          hint={sl > 0 && trigger > sl ? `${slPct.toFixed(1)}% from trigger` : 'Risk limit'}
          value={sl}
          onChange={onSl}
          step={0.5}
          tone="negative"
        />
      </div>
      {rr != null && (
        <div className="mt-4 rounded-full bg-surface-container px-4 py-2 text-body-sm text-on-surface-variant">
          Risk / reward ratio: <strong>{rr.toFixed(2)}x</strong> (reward / risk)
        </div>
      )}
    </>
  );
}

function NumField({
  label,
  hint,
  value,
  onChange,
  warning,
  step,
  tone,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  warning?: string | null;
  step?: number;
  tone?: 'positive' | 'negative';
}) {
  return (
    <label className="grid grid-cols-[1fr_minmax(128px,150px)] items-center gap-3 rounded-lg border border-outline-variant px-4 py-3">
      <span className="min-w-0">
        <span
          className={cn(
            'block text-label-lg',
            tone === 'positive' && 'text-positive',
            tone === 'negative' && 'text-negative',
            !tone && 'text-on-surface',
          )}
        >
          {label}
        </span>
        {hint && <span className="mt-0.5 block text-body-sm text-on-surface-variant">{hint}</span>}
        {warning && <span className="mt-1 block text-body-sm text-tertiary">{warning}</span>}
      </span>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('text-right font-mono', warning && 'border-tertiary')}
      />
    </label>
  );
}
