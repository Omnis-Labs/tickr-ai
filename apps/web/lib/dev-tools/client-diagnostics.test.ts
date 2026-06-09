import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDiagnosticValue } from './client-diagnostics';

test('client diagnostic sanitizer redacts signatures and wallet identifiers', () => {
  const sanitized = sanitizeDiagnosticValue({
    signature: 'signature-1234567890abcdef',
    walletAddress: 'wallet-1234567890abcdef',
    nested: { privyWalletId: 'privy-wallet-1234567890abcdef' },
    ticker: 'SPYx',
  }) as {
    signature: string;
    walletAddress: string;
    nested: { privyWalletId: string };
    ticker: string;
  };

  assert.match(sanitized.signature, /^\[redacted/);
  assert.match(sanitized.walletAddress, /^\[redacted/);
  assert.match(sanitized.nested.privyWalletId, /^\[redacted/);
  assert.equal(sanitized.ticker, 'SPYx');
});
