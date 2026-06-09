export type DepositAddressState = 'loading' | 'address' | 'signed-out';

interface DepositAddressInput {
  ready: boolean;
  connected: boolean;
  address: string | null;
}

export function depositAddressState({
  ready,
  connected,
  address,
}: DepositAddressInput): DepositAddressState {
  if (!ready) return 'loading';
  if (connected && address) return 'address';
  return 'signed-out';
}
