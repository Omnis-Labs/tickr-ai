import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@hunch-it/shared';

const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_PROGRAM_IDS = [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const;

export interface TokenProgramBalanceDebug {
  programId: string;
  walletRaw: string | null;
  accountCount: number | null;
  error: string | null;
}

export interface TokenMintBalanceRead {
  raw: bigint;
  programIds: string[];
  programs: TokenProgramBalanceDebug[];
}

function parsedTokenAccountRawAmount(
  account: { account: { data: unknown } },
  mint: string,
): bigint | null {
  const data = account.account.data;
  if (!data || typeof data !== 'object' || !('parsed' in data)) return null;
  const parsed = (
    data as { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown } } } }
  ).parsed;
  if (parsed?.info?.mint !== mint) return null;

  const raw = parsed.info.tokenAmount?.amount;
  if (raw == null) return 0n;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new Error(`Invalid token balance amount for ${mint}: ${String(raw)}`);
  }
  return BigInt(raw);
}

export async function readOwnerMintBalanceRaw(
  connection: Connection,
  owner: PublicKey,
  mint: string,
): Promise<TokenMintBalanceRead> {
  const programs: TokenProgramBalanceDebug[] = [];

  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
        programId: new PublicKey(programId),
      });
      let raw = 0n;
      let accountCount = 0;
      for (const account of accounts.value) {
        const accountRaw = parsedTokenAccountRawAmount(account, mint);
        if (accountRaw == null) continue;
        accountCount += 1;
        raw += accountRaw;
      }
      programs.push({
        programId,
        walletRaw: raw.toString(),
        accountCount,
        error: null,
      });
    } catch (err) {
      programs.push({
        programId,
        walletRaw: null,
        accountCount: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const successful = programs.filter((program) => program.error == null);
  if (successful.length === 0) {
    const detail = programs
      .map((program) => `${program.programId}: ${program.error ?? 'unknown error'}`)
      .join('; ');
    throw new Error(`Token balance lookup failed for ${mint}: ${detail}`);
  }

  const raw = successful.reduce(
    (acc, program) => acc + BigInt(program.walletRaw ?? '0'),
    0n,
  );
  const failed = programs.filter((program) => program.error != null);
  if (raw === 0n && failed.length > 0) {
    const detail = failed
      .map((program) => `${program.programId}: ${program.error ?? 'unknown error'}`)
      .join('; ');
    throw new Error(`Token balance lookup incomplete for ${mint}: ${detail}`);
  }

  return {
    raw,
    programIds: successful
      .filter((program) => BigInt(program.walletRaw ?? '0') > 0n)
      .map((program) => program.programId),
    programs,
  };
}
