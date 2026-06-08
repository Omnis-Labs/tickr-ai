import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar } from '@hunch-it/shared';
import { analyzeGrillIdea, getRequiredGrillBarAssetIds } from './analysis.js';

function dailyBars(closes: number[], startUnix = Date.UTC(2025, 0, 1) / 1000): Bar[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    return {
      time: startUnix + index * 86_400,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
    };
  });
}

test('Grill returns a Technical AI Analyst opinion through the public analysis interface', async () => {
  const bars = dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.8));

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'A friend thinks NVDAx is still a momentum buy after the latest move.',
    analystIds: ['technical'],
    barsByAssetId: new Map([['NVDAx', bars]]),
    now: new Date('2026-06-01T00:00:00.000Z'),
  });

  assert.equal(result.assetId, 'NVDAx');
  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'technical');
  assert.match(result.opinions[0]?.thesis ?? '', /trend|MACD|RSI/i);
  assert.match(result.opinions[0]?.setupEntry ?? '', /trigger|entry|confirm/i);
  assert.match(result.opinions[0]?.riskProtection ?? '', /risk|stop|drawdown/i);
});

test('Grill returns a Relative Strength AI Analyst opinion against benchmark bars', async () => {
  const assetBars = dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.9));
  const benchmarkBars = dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.1));

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because it keeps leading the market.',
    analystIds: ['relative_strength'],
    barsByAssetId: new Map([
      ['NVDAx', assetBars],
      ['SPYx', benchmarkBars],
    ]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'relative_strength');
  assert.match(result.opinions[0]?.thesis ?? '', /relative|benchmark|outperform/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /SPYx|benchmark/i);
});

test('Grill returns a Volatility Regime AI Analyst opinion with risk context', async () => {
  const calmThenNoisy = Array.from({ length: 180 }, (_, index) => 100 + index * 0.08).concat(
    Array.from({ length: 100 }, (_, index) => 114 + (index % 2 === 0 ? 5 : -5)),
  );

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The trade idea is to buy NVDAx, but only if the volatility spike is manageable.',
    analystIds: ['volatility_regime'],
    barsByAssetId: new Map([['NVDAx', dailyBars(calmThenNoisy)]]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'volatility_regime');
  assert.match(result.opinions[0]?.thesis ?? '', /volatility|vol/i);
  assert.match(result.opinions[0]?.riskProtection ?? '', /risk|drawdown|volatility/i);
});

test('Grill returns a Seasonality AI Analyst opinion through calendar readings', async () => {
  const closes: number[] = [];
  let price = 100;
  for (let index = 0; index < 520; index++) {
    const date = new Date(Date.UTC(2025, 0, 1 + index));
    price *= date.getUTCMonth() === 10 || date.getUTCMonth() === 11 ? 1.004 : 1.0002;
    closes.push(price);
  }

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because the year-end seasonal window is coming.',
    analystIds: ['seasonality'],
    barsByAssetId: new Map([['NVDAx', dailyBars(closes)]]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'seasonality');
  assert.match(result.opinions[0]?.thesis ?? '', /season|calendar|month/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 12|calendar/i);
});

test('Grill returns an Overnight Gap AI Analyst opinion with cost caveat', async () => {
  const bars: Bar[] = [];
  let close = 100;
  for (let index = 0; index < 180; index++) {
    const open = index === 0 ? close : close * 1.003;
    close = open * 1.0002;
    bars.push({
      time: Date.UTC(2025, 0, 1 + index) / 1000,
      open,
      high: close,
      low: open,
      close,
    });
  }

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because the gap behavior has been strong.',
    analystIds: ['overnight_gap'],
    barsByAssetId: new Map([['NVDAx', bars]]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'overnight_gap');
  assert.match(result.opinions[0]?.thesis ?? '', /overnight|intraday|gap/i);
  assert.match(result.opinions[0]?.riskProtection ?? '', /cost|round-trip|turnover/i);
});

test('Grill returns a Price Anomaly AI Analyst opinion using trailing windows', async () => {
  const closes = Array.from({ length: 260 }, (_, index) => 100 + index * 0.8).concat(
    Array.from({ length: 20 }, (_, index) => 307 + index * 0.2),
  );

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because it is pressing near a 52-week high.',
    analystIds: ['price_anomaly'],
    barsByAssetId: new Map([['NVDAx', dailyBars(closes)]]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'price_anomaly');
  assert.match(result.opinions[0]?.thesis ?? '', /52-week|anomaly|high|MAX/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 19|trailing/i);
});

test('Grill returns a Cross-Sectional Ranker AI Analyst opinion against a tradable universe', async () => {
  const universe = new Map<string, Bar[]>([
    ['NVDAx', dailyBars(Array.from({ length: 320 }, (_, index) => 100 + index * 1.2))],
    ['SPYx', dailyBars(Array.from({ length: 320 }, (_, index) => 100 + index * 0.2))],
    ['QQQx', dailyBars(Array.from({ length: 320 }, (_, index) => 100 + index * 0.4))],
  ]);

  const required = getRequiredGrillBarAssetIds('NVDAx', ['cross_sectional_ranker']);
  assert.ok(required.includes('NVDAx'));
  assert.ok(required.length >= 3);

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because it is one of the strongest names in the basket.',
    analystIds: ['cross_sectional_ranker'],
    barsByAssetId: universe,
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'cross_sectional_ranker');
  assert.match(result.opinions[0]?.thesis ?? '', /rank|factor|universe|cross-sectional/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 21|momentum|rank/i);
});

test('Grill uses a default AI Trading Team of three working analysts', async () => {
  const bars = dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.5));
  const benchmarkBars = dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.2));

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'Default team should challenge this NVDAx buy idea immediately.',
    barsByAssetId: new Map([
      ['NVDAx', bars],
      ['SPYx', benchmarkBars],
    ]),
  });

  assert.deepEqual(
    result.opinions.map((opinion) => opinion.analystId),
    ['technical', 'relative_strength', 'volatility_regime'],
  );
});
