export type BaseAnalysisRefreshReason = 'initial' | 'forced' | 'material_move' | 'bar_close';

export interface BaseAnalysisRefreshPolicy {
  /** Bucket size for the candle boundary that justifies a fresh analysis. */
  barCloseSeconds: number;
  /** Percent move from the last analyzed price that justifies a fresh analysis. */
  materialMovePct: number;
  /** Maximum age before refreshing even if price and bar bucket are quiet. */
  forceRefreshSeconds: number;
}

export interface BaseAnalysisRefreshInput {
  assetId: string;
  price: number;
  publishTimeUnix: number;
  nowUnixSeconds?: number;
}

export interface BaseAnalysisRefreshDecision {
  refresh: boolean;
  reason?: BaseAnalysisRefreshReason;
  priceMovePct: number;
  barBucketUnix: number;
  ageSeconds?: number;
}

interface BaseAnalysisRefreshState {
  price: number;
  analyzedAtUnix: number;
  barBucketUnix: number;
}

function barBucketUnix(publishTimeUnix: number, barCloseSeconds: number): number {
  return Math.floor(publishTimeUnix / barCloseSeconds) * barCloseSeconds;
}

function pctMove(from: number, to: number): number {
  if (!(from > 0)) return 0;
  return Math.abs((to / from - 1) * 100);
}

export class BaseAnalysisRefreshGate {
  private readonly stateByAsset = new Map<string, BaseAnalysisRefreshState>();

  constructor(private readonly policy: BaseAnalysisRefreshPolicy) {}

  shouldRefresh(input: BaseAnalysisRefreshInput): BaseAnalysisRefreshDecision {
    const nowUnixSeconds = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
    const bucket = barBucketUnix(input.publishTimeUnix, this.policy.barCloseSeconds);
    const previous = this.stateByAsset.get(input.assetId);

    if (!previous) {
      return {
        refresh: true,
        reason: 'initial',
        priceMovePct: 0,
        barBucketUnix: bucket,
      };
    }

    const ageSeconds = Math.max(0, nowUnixSeconds - previous.analyzedAtUnix);
    const priceMovePct = pctMove(previous.price, input.price);

    if (ageSeconds >= this.policy.forceRefreshSeconds) {
      return {
        refresh: true,
        reason: 'forced',
        priceMovePct,
        barBucketUnix: bucket,
        ageSeconds,
      };
    }

    if (priceMovePct >= this.policy.materialMovePct) {
      return {
        refresh: true,
        reason: 'material_move',
        priceMovePct,
        barBucketUnix: bucket,
        ageSeconds,
      };
    }

    if (bucket > previous.barBucketUnix) {
      return {
        refresh: true,
        reason: 'bar_close',
        priceMovePct,
        barBucketUnix: bucket,
        ageSeconds,
      };
    }

    return {
      refresh: false,
      priceMovePct,
      barBucketUnix: bucket,
      ageSeconds,
    };
  }

  markAnalyzed(input: BaseAnalysisRefreshInput): void {
    const nowUnixSeconds = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
    this.stateByAsset.set(input.assetId, {
      price: input.price,
      analyzedAtUnix: nowUnixSeconds,
      barBucketUnix: barBucketUnix(input.publishTimeUnix, this.policy.barCloseSeconds),
    });
  }
}
