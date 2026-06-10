import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const routeFiles = [
  'apps/web/app/api/orders/route.ts',
  'apps/web/app/api/orders/[id]/cancel/route.ts',
];

test('order write routes delegate Order mutations to PositionLifecycle', () => {
  for (const file of routeFiles) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');

    assert.doesNotMatch(
      source,
      /prisma\.order\.(create|update|updateMany|delete|deleteMany|upsert)\b/,
      `${file} should not write Order rows directly`,
    );
  }
});
