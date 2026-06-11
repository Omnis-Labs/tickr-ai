import type { Asset } from '@hunch-it/shared';

const HOT_GRILL_ASSET_IDS = ['NVDAx', 'HYPE', 'wBTC', 'ETH', 'TSLAx', 'SPYx'] as const;

export interface HotGrillAsset {
  assetId: string;
  displaySymbol: string;
  hashtag: string;
}

export function getHotGrillAssets(assets: readonly Asset[]): HotGrillAsset[] {
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]));

  return HOT_GRILL_ASSET_IDS.flatMap((assetId) => {
    const asset = byId.get(assetId);
    if (!asset) return [];
    return [
      {
        assetId: asset.assetId,
        displaySymbol: asset.displaySymbol,
        hashtag: `#${asset.displaySymbol}`,
      },
    ];
  });
}
