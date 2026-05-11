'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { Button } from '@/components/ui/button';
import {
  getRoomScene,
  ROOM_SCENE_SIZE,
  type RoomAsset,
  type RoomScene,
} from '@/lib/desk-growth/room-scene';
import { cn } from '@/lib/utils';
import {
  analystLevelUpCost,
  DESK_DECORATION_IDS,
  DESK_DECORATION_ITEMS,
  MAX_ANALYST_LEVEL,
  QUANT_ANALYST_COST_XP,
  type AnalystId,
  type DecorationId,
} from '@/lib/desk-growth/state';
import {
  DESK_GROWTH_CELEBRATION_EVENT,
  useDeskGrowth,
  type DeskGrowthCelebrationDetail,
} from '@/lib/desk-growth/use-desk-growth';

type ConfettiStyle = CSSProperties & {
  '--room-confetti-drift': string;
  '--room-confetti-rotation': string;
};

const CONFETTI_COLORS = ['#D0E906', '#BDEDF4', '#F5C896', '#20BFC6', '#FF745D'] as const;

const CONFETTI_PIECES = Array.from({ length: 72 }, (_, index) => ({
  id: index,
  x: (index * 37) % 100,
  drift: ((index * 29) % 180) - 90,
  delayMs: (index % 12) * 34,
  durationMs: 1280 + ((index * 41) % 560),
  width: 6 + (index % 4),
  height: 10 + (index % 5) * 2,
  rotation: (index * 47) % 360,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  radius: index % 5 === 0 ? '9999px' : '2px',
}));

export default function RoomPage() {
  const { state, recruitQuant, levelUp, buyDecoration } = useDeskGrowth();
  const quantOwned = state.analysts.quant.owned;
  const unlockedDecorationCount = Object.values(state.decorations).filter(Boolean).length;
  const deskStage = quantOwned ? 'Online' : 'Starter';
  const roomScene = getRoomScene(state.decorations, quantOwned);

  return (
    <>
      <DeskGrowthCelebration />
      <TopAppBar
        title="AI Trading Room"
        leftAction={<div className="h-9 w-9 rounded-full bg-surface-container-high" />}
      />
      <main className="mx-auto flex w-full max-w-[390px] flex-col gap-[18px] px-5 pb-28 pt-5">
        <section className="overflow-hidden rounded-lg bg-surface shadow-soft">
          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
            <div>
              <p className="text-label-md text-on-surface-variant">Desk EXP</p>
              <p className="font-mono text-number-lg text-primary">{state.xpBalance}</p>
            </div>
            <div className="shrink-0 rounded-full bg-accent px-4 py-2 text-label-lg text-on-accent">
              {deskStage}
            </div>
          </div>
          <PixelTradingRoom scene={roomScene} />
          <div className="grid grid-cols-3 border-t border-outline-variant bg-surface-container-low">
            <RoomStat label="Analysts" value={quantOwned ? '2' : '1'} />
            <RoomStat label="Upgrades" value={`${unlockedDecorationCount}/4`} />
            <RoomStat label="Level cap" value={String(MAX_ANALYST_LEVEL)} />
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">Team</h2>
            <span className="text-label-md text-on-surface-variant">
              Level cap {MAX_ANALYST_LEVEL}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            <AnalystCard
              id="junior"
              name="Junior Analyst"
              specialty="Proposal review"
              owned
              level={state.analysts.junior.level}
              xpBalance={state.xpBalance}
              onLevelUp={levelUp}
            />
            <AnalystCard
              id="quant"
              name="Quant Analyst"
              specialty="Market move read"
              owned={quantOwned}
              level={state.analysts.quant.level}
              xpBalance={state.xpBalance}
              onRecruit={recruitQuant}
              onLevelUp={levelUp}
            />
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">Desk upgrades</h2>
            <span className="text-label-md text-on-surface-variant">Ambient only</span>
          </div>
          <div className="flex flex-col gap-3">
            {DESK_DECORATION_IDS.map((id) => (
              <DecorationCard
                key={id}
                id={id}
                owned={state.decorations[id]}
                xpBalance={state.xpBalance}
                onBuy={buyDecoration}
              />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function DeskGrowthCelebration() {
  const [celebrations, setCelebrations] = useState<DeskGrowthCelebrationDetail[]>([]);

  useEffect(() => {
    const cleanupTimers = new Set<number>();

    function handleCelebration(event: Event) {
      const detail = (event as CustomEvent<DeskGrowthCelebrationDetail>).detail;
      if (!detail) return;

      setCelebrations((current) => [...current, detail].slice(-3));
      const cleanupTimer = window.setTimeout(() => {
        setCelebrations((current) => current.filter((item) => item.id !== detail.id));
        cleanupTimers.delete(cleanupTimer);
      }, 2_400);
      cleanupTimers.add(cleanupTimer);
    }

    window.addEventListener(DESK_GROWTH_CELEBRATION_EVENT, handleCelebration);
    return () => {
      window.removeEventListener(DESK_GROWTH_CELEBRATION_EVENT, handleCelebration);
      cleanupTimers.forEach((cleanupTimer) => window.clearTimeout(cleanupTimer));
    };
  }, []);

  const latestCelebration = celebrations.at(-1);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {latestCelebration?.label ?? ''}
      </div>
      {celebrations.length > 0 && (
        <div
          className="pointer-events-none fixed inset-0 z-[80] overflow-hidden"
          aria-hidden="true"
        >
          {celebrations.map((celebration, burstIndex) =>
            CONFETTI_PIECES.map((piece) => {
              const style: ConfettiStyle = {
                left: `${piece.x}%`,
                width: `${piece.width}px`,
                height: `${piece.height}px`,
                borderRadius: piece.radius,
                backgroundColor: piece.color,
                animationDelay: `${piece.delayMs + burstIndex * 80}ms`,
                animationDuration: `${piece.durationMs}ms`,
                '--room-confetti-drift': `${piece.drift}px`,
                '--room-confetti-rotation': `${piece.rotation}deg`,
              };

              return (
                <span
                  key={`${celebration.id}:${piece.id}`}
                  className="room-confetti-piece"
                  style={style}
                />
              );
            }),
          )}
        </div>
      )}
      <style jsx>{`
        .room-confetti-piece {
          position: absolute;
          top: -10vh;
          opacity: 0;
          transform: translate3d(0, -8vh, 0) rotate(var(--room-confetti-rotation));
          animation-name: room-confetti-fall;
          animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
          animation-fill-mode: forwards;
          will-change: transform, opacity;
        }

        @keyframes room-confetti-fall {
          0% {
            opacity: 0;
            transform: translate3d(0, -8vh, 0) rotate(var(--room-confetti-rotation));
          }

          12% {
            opacity: 1;
          }

          100% {
            opacity: 0;
            transform: translate3d(var(--room-confetti-drift), 108vh, 0)
              rotate(calc(var(--room-confetti-rotation) + 780deg));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .room-confetti-piece {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}

function RoomStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-label-sm text-on-surface-variant">{label}</p>
      <p className="mt-0.5 font-mono text-number-md text-primary">{value}</p>
    </div>
  );
}

function PixelTradingRoom({ scene }: { scene: RoomScene }) {
  return (
    <figure
      className="relative aspect-square overflow-hidden bg-surface-container"
      role="img"
      aria-label={scene.status}
    >
      <img
        aria-hidden="true"
        src={scene.background.src}
        alt=""
        width={scene.background.width}
        height={scene.background.height}
        draggable={false}
        className="h-full w-full select-none object-cover [image-rendering:pixelated]"
      />
      {scene.assets.map((asset) => (
        <RoomAssetImage key={asset.id} asset={asset} />
      ))}
    </figure>
  );
}

function RoomAssetImage({ asset }: { asset: RoomAsset }) {
  return (
    <img
      aria-hidden="true"
      alt=""
      src={asset.src}
      draggable={false}
      data-room-asset={asset.id}
      className="absolute select-none [image-rendering:pixelated]"
      style={{
        left: `${(asset.x / ROOM_SCENE_SIZE) * 100}%`,
        top: `${(asset.y / ROOM_SCENE_SIZE) * 100}%`,
        width: `${(asset.width / ROOM_SCENE_SIZE) * 100}%`,
        height: `${(asset.height / ROOM_SCENE_SIZE) * 100}%`,
      }}
    />
  );
}

function AnalystCard({
  id,
  name,
  specialty,
  owned,
  level,
  xpBalance,
  onRecruit,
  onLevelUp,
}: {
  id: AnalystId;
  name: string;
  specialty: string;
  owned: boolean;
  level: number;
  xpBalance: number;
  onRecruit?: () => boolean;
  onLevelUp: (id: AnalystId) => boolean;
}) {
  const nextCost = analystLevelUpCost(level);
  const atCap = level >= MAX_ANALYST_LEVEL;
  const canLevel = owned && !atCap && xpBalance >= nextCost;
  const canRecruit = !owned && xpBalance >= QUANT_ANALYST_COST_XP;

  return (
    <article className="rounded-lg bg-surface p-4 shadow-micro">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
            owned ? 'bg-accent text-on-accent' : 'bg-surface-container text-on-surface-variant',
          )}
        >
          <span className="material-symbols-outlined text-[22px]">
            {id === 'junior' ? 'person_search' : 'monitoring'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-title-md text-on-surface">{name}</h3>
            <span className="rounded-full bg-surface-container px-2 py-1 text-label-sm text-on-surface-variant">
              {owned ? `Lv ${level}` : 'Locked'}
            </span>
          </div>
          <p className="mt-1 text-body-sm text-on-surface-variant">{specialty}</p>
        </div>
      </div>
      <div className="mt-4">
        {owned ? (
          <Button
            variant="surface"
            size="sm"
            className="w-full"
            disabled={!canLevel}
            onClick={() => onLevelUp(id)}
          >
            {atCap ? 'Max level' : `Level up ${nextCost} XP`}
          </Button>
        ) : (
          <Button
            variant="accent"
            size="sm"
            className="w-full"
            disabled={!canRecruit}
            onClick={onRecruit}
          >
            Recruit {QUANT_ANALYST_COST_XP} XP
          </Button>
        )}
      </div>
    </article>
  );
}

function DecorationCard({
  id,
  owned,
  xpBalance,
  onBuy,
}: {
  id: DecorationId;
  owned: boolean;
  xpBalance: number;
  onBuy: (id: DecorationId) => boolean;
}) {
  const item = DESK_DECORATION_ITEMS[id];
  const cost = item.costXp;
  const canBuy = !owned && xpBalance >= cost;

  return (
    <article className="flex items-center gap-3 rounded-lg bg-surface p-4 shadow-micro">
      <div
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
          owned ? 'bg-accent text-on-accent' : 'bg-surface-container text-on-surface-variant',
        )}
      >
        <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-title-md text-on-surface">{item.name}</h3>
            <p className="mt-1 text-body-sm text-on-surface-variant">{item.detail}</p>
          </div>
          <p className="shrink-0 font-mono text-label-md text-on-surface-variant">{cost} XP</p>
        </div>
        <Button
          variant={owned ? 'surface' : 'outline'}
          size="sm"
          className="mt-3 w-full"
          disabled={!canBuy}
          onClick={() => onBuy(id)}
        >
          {owned ? 'Owned' : 'Buy'}
        </Button>
      </div>
    </article>
  );
}
