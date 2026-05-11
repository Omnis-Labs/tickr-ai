import { DESK_DECORATION_IDS, DESK_DECORATION_ITEMS, type DeskDecorations } from './state';

export interface RoomAsset {
  id: string;
  src: string;
  alt: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomScene {
  background: typeof ROOM_BACKGROUND;
  assets: RoomAsset[];
  status: string;
}

export const ROOM_SCENE_SIZE = 750;

export const ROOM_BACKGROUND = {
  src: '/room/office-background.png',
  alt: 'Pixel office trading room with two desks, wall chart, and tiled floor',
  width: ROOM_SCENE_SIZE,
  height: ROOM_SCENE_SIZE,
} as const;

const baseAssets: RoomAsset[] = [
  {
    id: 'junior-analyst',
    src: '/room/office/red-hair-character.png',
    alt: 'Junior Analyst',
    x: 276,
    y: 596,
    width: 76,
    height: 96,
  },
];

export function getRoomScene(decorations: DeskDecorations, quantOwned: boolean): RoomScene {
  const assets: RoomAsset[] = [...baseAssets];

  if (decorations.wallChart) {
    assets.push({
      id: 'wall-chart',
      src: '/room/desk/wall-chart.png',
      alt: 'Wall Chart',
      x: 86,
      y: 126,
      width: 115,
      height: 85,
    });
  }

  if (decorations.vendingMachine) {
    assets.push({
      id: 'vending-machine',
      src: '/room/office/red-vending-machine.png',
      alt: 'Vending Machine',
      x: 658,
      y: 220,
      width: 45,
      height: 70,
    });
  }

  if (decorations.secondScreen) {
    assets.push(
      {
        id: 'monitor-right',
        src: '/room/desk/computer-monitor.png',
        alt: 'Second Screen monitor',
        x: 390,
        y: 404,
        width: 80,
        height: 92,
      },
      {
        id: 'keyboard-right',
        src: '/room/desk/keyboard.png',
        alt: 'Second Screen keyboard',
        x: 404,
        y: 540,
        width: 64,
        height: 36,
      },
      {
        id: 'mouse-right',
        src: '/room/desk/mouse.png',
        alt: 'Second Screen mouse',
        x: 506,
        y: 538,
        width: 24,
        height: 24,
      },
    );
  }

  if (quantOwned) {
    assets.push({
      id: 'quant-analyst',
      src: '/room/office/dark-hair-suit-character.png',
      alt: 'Quant Analyst',
      x: 430,
      y: 582,
      width: 68,
      height: 92,
    });
  }

  if (decorations.deskDog) {
    assets.push({
      id: 'desk-dog',
      src: '/room/office/dog.png',
      alt: 'Desk Dog',
      x: 104,
      y: 648,
      width: 96,
      height: 44,
    });
  }

  return {
    background: ROOM_BACKGROUND,
    assets,
    status: getRoomStatus(decorations, quantOwned),
  };
}

export function getRoomStatus(decorations: DeskDecorations, quantOwned: boolean): string {
  const activeDecorations = DESK_DECORATION_IDS.filter((id) => decorations[id]).map(
    (id) => DESK_DECORATION_ITEMS[id].name,
  );
  const analysts = quantOwned ? 'Junior Analyst and Quant Analyst online' : 'Junior Analyst online';
  const upgrades =
    activeDecorations.length > 0
      ? `Installed upgrades: ${activeDecorations.join(', ')}.`
      : 'No room upgrades installed yet.';

  return `Pixel-art AI trading desk. ${analysts}. ${upgrades}`;
}
