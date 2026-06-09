import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowDeskPortfolioLoading, shouldShowDeskSectionLoading } from './loading-state';

test('desk portfolio stays loading while the protected query has no data yet', () => {
  assert.equal(
    shouldShowDeskPortfolioLoading({
      isLoading: false,
      isPending: true,
      hasData: false,
      hasError: false,
    }),
    true,
  );
});

test('desk portfolio stops loading once data exists', () => {
  assert.equal(
    shouldShowDeskPortfolioLoading({
      isLoading: false,
      isPending: false,
      hasData: true,
      hasError: false,
    }),
    false,
  );
});

test('desk portfolio shows the error state instead of a loading skeleton', () => {
  assert.equal(
    shouldShowDeskPortfolioLoading({
      isLoading: false,
      isPending: true,
      hasData: false,
      hasError: true,
    }),
    false,
  );
});

test('desk sections stay loading while a protected query is pending', () => {
  assert.equal(
    shouldShowDeskSectionLoading({
      isLoading: false,
      isPending: true,
      hasError: false,
    }),
    true,
  );
});
