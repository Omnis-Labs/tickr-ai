import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearGrillAnalysisDraftsForTests,
  consumeGrillAnalysisDraft,
  saveGrillAnalysisDraft,
} from './drafts.js';
import type { GrillAnalysisResult } from './analysis.js';

function analysis(): GrillAnalysisResult {
  return {
    assetId: 'NVDAx',
    idea: 'A friend thinks NVDAx can keep trending after earnings.',
    asOf: '2026-06-10T00:00:00.000Z',
    opinions: [],
  };
}

test('Grill analysis drafts are consumed once for the exact user request', () => {
  clearGrillAnalysisDraftsForTests();
  const request = {
    assetId: 'NVDAx',
    idea: 'A friend thinks NVDAx can keep trending after earnings.',
    analystIds: ['technical', 'relative_strength'],
  };
  const saved = analysis();

  saveGrillAnalysisDraft({
    userId: 'user-1',
    request,
    analysis: saved,
    nowMs: () => 1_000,
  });

  assert.equal(
    consumeGrillAnalysisDraft({
      userId: 'user-1',
      request: { ...request, idea: 'A friend thinks NVDAx can keep trending after earnings?' },
      nowMs: () => 2_000,
    }),
    null,
  );
  assert.equal(
    consumeGrillAnalysisDraft({
      userId: 'user-2',
      request,
      nowMs: () => 2_000,
    }),
    null,
  );
  assert.equal(
    consumeGrillAnalysisDraft({
      userId: 'user-1',
      request,
      nowMs: () => 2_000,
    }),
    saved,
  );
  assert.equal(
    consumeGrillAnalysisDraft({
      userId: 'user-1',
      request,
      nowMs: () => 2_000,
    }),
    null,
  );
});

test('Grill analysis drafts expire after the short-lived proposal window', () => {
  clearGrillAnalysisDraftsForTests();
  const request = {
    assetId: 'NVDAx',
    idea: 'A friend thinks NVDAx can keep trending after earnings.',
    analystIds: ['technical'],
  };

  saveGrillAnalysisDraft({
    userId: 'user-1',
    request,
    analysis: analysis(),
    nowMs: () => 1_000,
  });

  assert.equal(
    consumeGrillAnalysisDraft({
      userId: 'user-1',
      request,
      nowMs: () => 1_000 + 10 * 60_000,
    }),
    null,
  );
});
