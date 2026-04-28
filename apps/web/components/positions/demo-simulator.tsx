'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface DemoSimulatorProps {
  onSimTp: () => void;
  onSimSl: () => void;
}

/**
 * Demo-only OCO simulator card. Lets us verify the cancel-sibling banner UX
 * end-to-end without waiting for the real Order Tracker / Jupiter fill.
 */
export function DemoSimulator({ onSimTp, onSimSl }: DemoSimulatorProps) {
  return (
    <Card className="mb-4 border-dashed border-tertiary/40 bg-tertiary-container/20">
      <CardContent className="p-5">
        <div className="mb-2 text-xs uppercase tracking-wider text-tertiary">
          DEMO ONLY · SIMULATE OCO FILL
        </div>
        <div className="flex gap-3">
          <Button
            className="flex-1 bg-positive text-on-positive hover:bg-positive/80"
            onClick={onSimTp}
          >
            Simulate TP fill
          </Button>
          <Button variant="destructive" className="flex-1" onClick={onSimSl}>
            Simulate SL fill
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
