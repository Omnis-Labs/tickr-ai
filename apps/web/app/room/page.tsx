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
  type DeskGrowthCelebrationOrigin,
} from '@/lib/desk-growth/use-desk-growth';

type ConfettiStyle = CSSProperties & {
  '--room-confetti-launch-x': string;
  '--room-confetti-launch-y': string;
  '--room-confetti-settle-x': string;
  '--room-confetti-settle-y': string;
  '--room-confetti-end-x': string;
  '--room-confetti-end-y': string;
  '--room-confetti-rotation': string;
  '--room-confetti-mid-rotation': string;
  '--room-confetti-end-rotation': string;
};

const CONFETTI_COLORS = ['#D0E906', '#BDEDF4', '#F5C896', '#20BFC6', '#FF745D'] as const;

const CONFETTI_PIECES = Array.from({ length: 96 }, (_, index) => {
  const direction = index % 2 === 0 ? 1 : -1;
  const rotation = (index * 43) % 360;
  const isDot = index % 11 === 0;
  const isRibbon = index % 7 === 0;

  return {
    id: index,
    startX: ((index * 7) % 13) - 6,
    startY: ((index * 11) % 9) - 4,
    launchX: direction * (18 + ((index * 17) % 126)),
    launchY: -(48 + ((index * 19) % 118)),
    settleX: direction * (28 + ((index * 31) % 156)),
    settleY: -(14 + ((index * 13) % 58)),
    endX: direction * (24 + ((index * 29) % 190)),
    endY: 80 + ((index * 23) % 160),
    delayMs: (index % 14) * 16,
    durationMs: 1_640 + ((index * 47) % 620),
    width: isDot ? 7 : isRibbon ? 5 : 7 + (index % 4),
    height: isDot ? 7 : isRibbon ? 22 : 12 + (index % 5) * 2,
    rotation,
    midRotation: rotation + direction * (220 + ((index * 37) % 180)),
    endRotation: rotation + direction * (680 + ((index * 41) % 360)),
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    radius: isDot ? '9999px' : isRibbon ? '9999px' : '2px',
  };
});

function getCelebrationOrigin(element: HTMLElement): DeskGrowthCelebrationOrigin {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

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
      }, 3_000);
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
                left: `${celebration.origin.x + piece.startX}px`,
                top: `${celebration.origin.y + piece.startY}px`,
                width: `${piece.width}px`,
                height: `${piece.height}px`,
                borderRadius: piece.radius,
                backgroundColor: piece.color,
                animationDelay: `${piece.delayMs + burstIndex * 80}ms`,
                animationDuration: `${piece.durationMs}ms`,
                '--room-confetti-launch-x': `${piece.launchX}px`,
                '--room-confetti-launch-y': `${piece.launchY}px`,
                '--room-confetti-settle-x': `${piece.settleX}px`,
                '--room-confetti-settle-y': `${piece.settleY}px`,
                '--room-confetti-end-x': `${piece.endX}px`,
                '--room-confetti-end-y': `${piece.endY}px`,
                '--room-confetti-rotation': `${piece.rotation}deg`,
                '--room-confetti-mid-rotation': `${piece.midRotation}deg`,
                '--room-confetti-end-rotation': `${piece.endRotation}deg`,
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
          opacity: 0;
          transform: translate(-50%, -50%) translate3d(0, 0, 0)
            rotate(var(--room-confetti-rotation)) scale(0.52);
          transform-origin: 50% 50%;
          animation-name: room-confetti-burst;
          animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
          animation-fill-mode: forwards;
          will-change: transform, opacity;
        }

        @keyframes room-confetti-burst {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) translate3d(0, 0, 0)
              rotate(var(--room-confetti-rotation)) scale(0.52);
          }

          9% {
            opacity: 1;
          }

          34% {
            opacity: 1;
            transform: translate(-50%, -50%)
              translate3d(var(--room-confetti-launch-x), var(--room-confetti-launch-y), 0)
              rotate(var(--room-confetti-mid-rotation)) scale(1);
          }

          68% {
            opacity: 0.96;
            transform: translate(-50%, -50%)
              translate3d(var(--room-confetti-settle-x), var(--room-confetti-settle-y), 0)
              rotate(calc(var(--room-confetti-mid-rotation) - 130deg)) scale(0.96);
          }

          100% {
            opacity: 0;
            transform: translate(-50%, -50%)
              translate3d(var(--room-confetti-end-x), var(--room-confetti-end-y), 0)
              rotate(var(--room-confetti-end-rotation)) scale(0.86);
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
  onRecruit?: (origin: DeskGrowthCelebrationOrigin) => boolean;
  onLevelUp: (id: AnalystId, origin: DeskGrowthCelebrationOrigin) => boolean;
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
            onClick={(event) => onLevelUp(id, getCelebrationOrigin(event.currentTarget))}
          >
            {atCap ? 'Max level' : `Level up ${nextCost} XP`}
          </Button>
        ) : (
          <Button
            variant="accent"
            size="sm"
            className="w-full"
            disabled={!canRecruit}
            onClick={(event) => onRecruit?.(getCelebrationOrigin(event.currentTarget))}
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
  onBuy: (id: DecorationId, origin: DeskGrowthCelebrationOrigin) => boolean;
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
          onClick={(event) => onBuy(id, getCelebrationOrigin(event.currentTarget))}
        >
          {owned ? 'Owned' : 'Buy'}
        </Button>
      </div>
    </article>
  );
}
