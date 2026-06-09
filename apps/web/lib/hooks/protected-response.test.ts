import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtectedReadError, readProtectedJson } from './protected-response';

test('protected JSON reads return parsed data for successful responses', async () => {
  const data = await readProtectedJson<{ ok: true }>(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

  assert.deepEqual(data, { ok: true });
});

test('protected JSON reads reject non-OK responses instead of returning empty data', async () => {
  await assert.rejects(
    () => readProtectedJson(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })),
    (error) =>
      error instanceof ProtectedReadError &&
      error.status === 401 &&
      error.message === 'Protected read failed with 401 Unauthorized',
  );
});
