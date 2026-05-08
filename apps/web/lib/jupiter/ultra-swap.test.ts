import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@hunch-it/shared';
import { readOwnerMintBalanceRaw } from './ultra-swap';

const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const HYPE_MINT = '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g';
const AAPLX_MINT = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp';
const OWNER = new PublicKey('11111111111111111111111111111112');

function parsedAccount(mint: string, rawAmount: string) {
  return {
    account: {
      data: {
        parsed: {
          info: {
            mint,
            tokenAmount: { amount: rawAmount },
          },
        },
      },
    },
  };
}

test('sell balance lookup reads classic SPL token accounts for whitelisted crypto mints', async () => {
  const calls: string[] = [];
  const connection = {
    getParsedTokenAccountsByOwner: async (_owner: PublicKey, filter: { programId: PublicKey }) => {
      const programId = filter.programId.toBase58();
      calls.push(programId);
      return {
        value: programId === SPL_TOKEN_PROGRAM_ID ? [parsedAccount(HYPE_MINT, '112064705')] : [],
      };
    },
  };

  const balance = await readOwnerMintBalanceRaw(connection, OWNER, HYPE_MINT);

  assert.equal(balance.raw, 112064705n);
  assert.deepEqual(balance.programIds, [SPL_TOKEN_PROGRAM_ID]);
  assert.deepEqual(calls, [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);
});

test('sell balance lookup preserves xStock Token-2022 balances', async () => {
  const connection = {
    getParsedTokenAccountsByOwner: async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      value:
        filter.programId.toBase58() === TOKEN_2022_PROGRAM_ID
          ? [parsedAccount(AAPLX_MINT, '500')]
          : [],
    }),
  };

  const balance = await readOwnerMintBalanceRaw(connection, OWNER, AAPLX_MINT);

  assert.equal(balance.raw, 500n);
  assert.deepEqual(balance.programIds, [TOKEN_2022_PROGRAM_ID]);
});
