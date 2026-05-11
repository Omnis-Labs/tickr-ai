import assert from 'node:assert/strict';
import test from 'node:test';
import { getRoomScene, ROOM_BACKGROUND, type RoomAsset } from './room-scene';
import { DESK_DECORATION_ITEMS } from './state';
import type { DeskDecorations } from './state';

const allDecorations: DeskDecorations = {
  vendingMachine: true,
  secondScreen: true,
  wallChart: true,
  deskDog: true,
};

function findAsset(assets: RoomAsset[], id: string): RoomAsset {
  const asset = assets.find((item) => item.id === id);
  assert.ok(asset, `expected ${id} to be present`);
  return asset;
}

test('AI trading room presents the curated scene assets', () => {
  const scene = getRoomScene(allDecorations, true);

  assert.equal(ROOM_BACKGROUND.src, '/room/office-background.png');
  assert.equal(DESK_DECORATION_ITEMS.vendingMachine.name, 'Vending Machine');
  assert.equal(DESK_DECORATION_ITEMS.wallChart.name, 'Wall Chart');
  assert.equal(DESK_DECORATION_ITEMS.deskDog.name, 'Desk Dog');

  assert.equal(
    findAsset(scene.assets, 'vending-machine').src,
    '/room/office/red-vending-machine.png',
  );
  assert.equal(findAsset(scene.assets, 'wall-chart').src, '/room/desk/wall-chart.png');
  assert.equal(findAsset(scene.assets, 'desk-dog').src, '/room/office/dog.png');
  assert.equal(
    findAsset(scene.assets, 'quant-analyst').src,
    '/room/office/dark-hair-suit-character.png',
  );

  assert.match(scene.status, /Vending Machine/);
  assert.match(scene.status, /Wall Chart/);
  assert.match(scene.status, /Desk Dog/);
  assert.doesNotMatch(scene.status, /Coffee Mug|Market Clock|Desk Cat/);
});
