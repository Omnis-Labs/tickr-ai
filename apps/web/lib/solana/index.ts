import { Connection } from '@solana/web3.js';
import { createRpcRoundRobin } from '@hunch-it/shared';

const nextRpcUrl = createRpcRoundRobin(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS);

let connection: Connection | null = null;
let currentUrl: string | null = null;

export function getConnection(): Connection {
  const url = nextRpcUrl();
  if (connection && currentUrl === url) return connection;
  currentUrl = url;
  connection = new Connection(url, 'confirmed');
  return connection;
}
