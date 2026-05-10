type Decimalish = number | { toNumber: () => number };
type NullableDecimalish = Decimalish | null;

export interface OpenOrderRecord {
  id: string;
  positionId: string;
  kind: string;
  side: string;
  status: string;
  jupiterOrderId: string | null;
  triggerPriceUsd: NullableDecimalish;
  sizeUsd: Decimalish;
  tokenAmount: NullableDecimalish;
  position: {
    ticker: string;
  };
}

export interface OpenOrderRow {
  id: string;
  positionId: string;
  ticker: string;
  kind: string;
  side: string;
  status: string;
  jupiterOrderId: string | null;
  triggerPriceUsd: number | null;
  sizeUsd: number;
  tokenAmount: number | null;
}

function decimalishToNumber(value: Decimalish): number {
  return typeof value === 'number' ? value : value.toNumber();
}

function nullableDecimalishToNumber(value: NullableDecimalish): number | null {
  return value == null ? null : decimalishToNumber(value);
}

export function serializeOpenOrderForClient(order: OpenOrderRecord): OpenOrderRow {
  return {
    id: order.id,
    positionId: order.positionId,
    ticker: order.position.ticker,
    kind: order.kind,
    side: order.side,
    status: order.status,
    jupiterOrderId: order.jupiterOrderId,
    triggerPriceUsd: nullableDecimalishToNumber(order.triggerPriceUsd),
    sizeUsd: decimalishToNumber(order.sizeUsd),
    tokenAmount: nullableDecimalishToNumber(order.tokenAmount),
  };
}

export function serializeOpenOrdersForClient(orders: OpenOrderRecord[]): OpenOrderRow[] {
  return orders.map((order) => serializeOpenOrderForClient(order));
}
