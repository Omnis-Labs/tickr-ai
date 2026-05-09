export interface JupiterUltraOrderLike {
  requestId?: string | null;
  transaction?: unknown;
  error?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
  [key: string]: unknown;
}

export type UltraOrderProblemCode = 'insufficient_funds' | 'ultra_order_unavailable';

export interface UltraOrderProblem {
  code: UltraOrderProblemCode;
  message: string;
  detail: {
    requestId: string | null;
    error: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    transactionLength: number;
  };
}

function stringField(order: JupiterUltraOrderLike, key: string): string | null {
  const value = order[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getUltraOrderProblem(order: JupiterUltraOrderLike): UltraOrderProblem | null {
  const transaction = typeof order.transaction === 'string' ? order.transaction : '';
  const error = stringField(order, 'error');
  const errorCode = stringField(order, 'errorCode');
  const errorMessage = stringField(order, 'errorMessage');
  const combined = [error, errorCode, errorMessage].filter(Boolean).join(' ');

  if (transaction.length > 0 && !combined) return null;

  const code = /insufficient\s+funds/i.test(combined)
    ? 'insufficient_funds'
    : 'ultra_order_unavailable';
  const message =
    code === 'insufficient_funds'
      ? 'insufficient_funds'
      : errorMessage || error || errorCode || 'ultra_order_missing_transaction';

  return {
    code,
    message,
    detail: {
      requestId: typeof order.requestId === 'string' ? order.requestId : null,
      error,
      errorCode,
      errorMessage,
      transactionLength: transaction.length,
    },
  };
}
