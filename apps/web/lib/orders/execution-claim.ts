type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class OrderExecutionClaimError extends Error {
  constructor(
    public readonly reason: string,
    public readonly statusCode: number,
  ) {
    super(reason);
    this.name = 'OrderExecutionClaimError';
  }
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `${res.status}`;
}

export async function claimOrderExecution(
  authedFetch: AuthedFetch,
  orderId: string,
): Promise<unknown> {
  const res = await authedFetch(`/api/orders/${orderId}/execution-claim`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new OrderExecutionClaimError(await parseError(res), res.status);
  }
  return res.json();
}

export async function releaseOrderExecutionClaim(
  authedFetch: AuthedFetch,
  orderId: string,
): Promise<unknown> {
  const res = await authedFetch(`/api/orders/${orderId}/execution-claim`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new OrderExecutionClaimError(await parseError(res), res.status);
  }
  return res.json();
}

export function isOrderAlreadyHandled(reason: string): boolean {
  return (
    reason === 'order_filled' ||
    reason === 'order_cancelled' ||
    reason === 'order_expired' ||
    reason === 'position_state_closed'
  );
}

export function isOrderAlreadyExecuting(reason: string): boolean {
  return (
    reason === 'order_pending' ||
    reason === 'position_state_entering' ||
    reason === 'position_state_closing'
  );
}
