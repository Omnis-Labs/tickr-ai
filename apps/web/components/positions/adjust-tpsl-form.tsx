'use client';

import { useEffect, useRef, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ProtectionLeg = 'tp' | 'sl';

interface AdjustTpSlFormProps {
  tpDraft: string;
  slDraft: string;
  busy: boolean;
  focusLeg?: ProtectionLeg | null;
  focusKey?: string;
  onTpChange: (v: string) => void;
  onSlChange: (v: string) => void;
  onSubmit: () => void;
}

/**
 * Adjust TP / SL form for ACTIVE positions. Two number inputs + an Update
 * button. The page handles the actual cancel + re-place flow.
 */
export function AdjustTpSlForm({
  tpDraft,
  slDraft,
  busy,
  focusLeg,
  focusKey,
  onTpChange,
  onSlChange,
  onSubmit,
}: AdjustTpSlFormProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const tpInputRef = useRef<HTMLInputElement>(null);
  const slInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusLeg) return;
    const frame = window.requestAnimationFrame(() => {
      const input = focusLeg === 'tp' ? tpInputRef.current : slInputRef.current;
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus({ preventScroll: true });
      input?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusLeg, focusKey]);

  return (
    <Card ref={cardRef} className="mb-4">
      <CardHeader>
        <CardTitle className="text-lg font-bold">Adjust TP / SL</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <NumField
            inputRef={tpInputRef}
            label="Take profit"
            value={tpDraft}
            onChange={onTpChange}
            tone="positive"
          />
          <NumField
            inputRef={slInputRef}
            label="Stop loss"
            value={slDraft}
            onChange={onSlChange}
            tone="negative"
          />
          <Button disabled={busy} onClick={onSubmit}>
            Update
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NumField({
  inputRef,
  label,
  value,
  onChange,
  tone,
}: {
  inputRef?: Ref<HTMLInputElement>;
  label: string;
  value: string;
  onChange: (v: string) => void;
  tone?: 'positive' | 'negative';
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className={cn(
          'text-xs',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          !tone && 'text-on-surface-variant',
        )}
      >
        {label}
      </span>
      <Input
        ref={inputRef}
        type="number"
        value={value}
        step={0.5}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
