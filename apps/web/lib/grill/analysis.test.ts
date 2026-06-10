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

test('Default Grill team for a crypto asset requests only the asset and crypto benchmark bars', () => {
  assert.deepEqual(getRequiredGrillBarAssetIds('wBTC'), ['wBTC', 'ETH']);
  assert.deepEqual(getRequiredGrillBarAssetIds('ETH'), ['ETH', 'wBTC']);
});

test('Default Grill team for an xStock asset requests only the asset and xStock benchmark bars', () => {
  assert.deepEqual(getRequiredGrillBarAssetIds('NVDAx'), ['NVDAx', 'SPYx']);
  assert.deepEqual(getRequiredGrillBarAssetIds('SPYx'), ['SPYx', 'QQQx']);
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

test('Grill returns a Portfolio Risk Sizer AI Analyst opinion with target weight context', async () => {
  const universe = new Map<string, Bar[]>([
    ['NVDAx', dailyBars(Array.from({ length: 320 }, (_, index) => 100 + index * 1.1))],
    ['SPYx', dailyBars(Array.from({ length: 320 }, (_, index) => 100 + index * 0.25))],
    ['QQQx', dailyBars(Array.from({ length: 320 }, (_, index) => 100 + index * 0.45))],
    ['AAPLx', dailyBars(Array.from({ length: 320 }, (_, index) => 100 + index * 0.65))],
  ]);

  const required = getRequiredGrillBarAssetIds('NVDAx', ['portfolio_risk_sizer']);
  assert.ok(required.includes('NVDAx'));
  assert.ok(required.length >= 3);

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx, but only if it deserves portfolio risk budget.',
    analystIds: ['portfolio_risk_sizer'],
    barsByAssetId: universe,
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'portfolio_risk_sizer');
  assert.match(result.opinions[0]?.thesis ?? '', /portfolio|weight|risk/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 10|rebalance|weight/i);
});

test('Grill returns a Pairs Trading AI Analyst opinion against an auto-selected supported pair', async () => {
  const n = 320;
  const base = Array.from({ length: n }, (_, index) => 100 + index * 0.15);
  const nvda = base.map((value, index) => {
    if (index >= 250 && index < 270) return value + 9 * (1 - (index - 250) / 20);
    return value;
  });

  const required = getRequiredGrillBarAssetIds('NVDAx', ['pairs_trading']);
  assert.ok(required.includes('NVDAx'));
  assert.ok(required.some((assetId) => assetId !== 'NVDAx'));

  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx after it diverged from the mega-cap tech basket.',
    analystIds: ['pairs_trading'],
    barsByAssetId: new Map([
      ['NVDAx', dailyBars(nvda)],
      ['QQQx', dailyBars(base)],
      ['SPYx', dailyBars(base.map((value) => value * 0.98))],
    ]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'pairs_trading');
  assert.match(result.opinions[0]?.thesis ?? '', /pair|spread|z-score/i);
  assert.match(
    result.opinions[0]?.riskProtection ?? '',
    /short|borrow|relationship|market-neutral/i,
  );
});

test('Grill returns a Meihua null-control AI Analyst opinion without treating it as trade support', async () => {
  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because several unrelated timing models agree.',
    analystIds: ['meihua_null_control'],
    barsByAssetId: new Map([
      ['NVDAx', dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.3))],
    ]),
    now: new Date('2026-06-01T00:00:00.000Z'),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'meihua_null_control');
  assert.equal(result.opinions[0]?.verdict, 'challenge');
  assert.match(result.opinions[0]?.thesis ?? '', /control|placebo|Meihua/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 26|null|seed/i);
});

test('Grill returns a Bazi null-control AI Analyst opinion using the first visible bar as anchor', async () => {
  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because a calendar control says the year is favorable.',
    analystIds: ['bazi_null_control'],
    barsByAssetId: new Map([
      ['NVDAx', dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.28))],
    ]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'bazi_null_control');
  assert.equal(result.opinions[0]?.verdict, 'challenge');
  assert.match(result.opinions[0]?.thesis ?? '', /control|placebo|Bazi/i);
  assert.match(
    result.opinions[0]?.evidence.join(' ') ?? '',
    /Task 27|favorable|first visible bar/i,
  );
});

test('Grill returns a Suimei null-control AI Analyst opinion reusing the Bazi calendar', async () => {
  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because a Japanese four-pillar control is thriving.',
    analystIds: ['suimei_null_control'],
    barsByAssetId: new Map([
      ['NVDAx', dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.22))],
    ]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'suimei_null_control');
  assert.equal(result.opinions[0]?.verdict, 'challenge');
  assert.match(result.opinions[0]?.thesis ?? '', /control|placebo|Suimei/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 29|twelve fortune|tenchusatsu/i);
});

test('Grill returns a Tieban null-control AI Analyst opinion through the public interface', async () => {
  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because an iron-plate numerology count is favorable.',
    analystIds: ['tieban_null_control'],
    barsByAssetId: new Map([
      ['NVDAx', dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.2))],
    ]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'tieban_null_control');
  assert.equal(result.opinions[0]?.verdict, 'challenge');
  assert.match(result.opinions[0]?.thesis ?? '', /control|placebo|Tieban/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 31|verse|Taixuan/i);
});

test('Grill returns a Qimen null-control AI Analyst opinion through the public interface', async () => {
  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because a timing system says the gate is favorable.',
    analystIds: ['qimen_null_control'],
    barsByAssetId: new Map([
      ['NVDAx', dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.25))],
    ]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'qimen_null_control');
  assert.equal(result.opinions[0]?.verdict, 'challenge');
  assert.match(result.opinions[0]?.thesis ?? '', /control|placebo|Qimen/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 32|gate|null/i);
});

test('Grill returns a Liuren null-control AI Analyst opinion with the solar-sign gate caveat', async () => {
  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because a Three Styles control supports the useful god.',
    analystIds: ['liuren_null_control'],
    barsByAssetId: new Map([
      ['NVDAx', dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.18))],
    ]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'liuren_null_control');
  assert.equal(result.opinions[0]?.verdict, 'challenge');
  assert.match(result.opinions[0]?.thesis ?? '', /control|placebo|Liuren/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 33|yue jiang|solar-sign/i);
});

test('Grill returns a Taiyi null-control AI Analyst opinion through the public interface', async () => {
  const result = await analyzeGrillIdea({
    assetId: 'NVDAx',
    idea: 'The idea is to buy NVDAx because a host-versus-guest timing count says so.',
    analystIds: ['taiyi_null_control'],
    barsByAssetId: new Map([
      ['NVDAx', dailyBars(Array.from({ length: 280 }, (_, index) => 100 + index * 0.2))],
    ]),
  });

  assert.equal(result.opinions.length, 1);
  assert.equal(result.opinions[0]?.analystId, 'taiyi_null_control');
  assert.equal(result.opinions[0]?.verdict, 'challenge');
  assert.match(result.opinions[0]?.thesis ?? '', /control|placebo|Taiyi/i);
  assert.match(result.opinions[0]?.evidence.join(' ') ?? '', /Task 34|host|guest|null/i);
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
