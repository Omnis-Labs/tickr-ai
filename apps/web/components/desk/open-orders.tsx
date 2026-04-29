'use client';

import { motion } from 'framer-motion';

// Mock types
type OrderKind = 'TAKE_PROFIT' | 'STOP_LOSS' | 'BUY_TRIGGER';
type OrderStatus = 'OPEN' | 'CLOSED';

interface MockOrder {
  id: string;
  kind: OrderKind;
  status: OrderStatus;
  assetId: string;
  positionId: string;
  sizeUsd: number;
  triggerPriceUsd?: number;
  ticker?: string;
}

// TODO(integration): Fetch open orders from API/store
export function OpenOrders() {
  const isLoading = false;
  const error = null;
  const orders: MockOrder[] = [
    {
      id: '1',
      kind: 'TAKE_PROFIT',
      status: 'OPEN',
      assetId: 'btc',
      positionId: 'pos_1',
      sizeUsd: 1000,
      triggerPriceUsd: 65000,
      ticker: 'BTC',
    },
    {
      id: '2',
      kind: 'STOP_LOSS',
      status: 'OPEN',
      assetId: 'eth',
      positionId: 'pos_2',
      sizeUsd: 500,
      triggerPriceUsd: 3000,
      ticker: 'ETH',
    }
  ];

  return (
    <motion.section 
      className="mt-8 flex flex-col gap-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <h3 className="text-title-lg text-primary mb-2">Open Orders</h3>
      
      {isLoading ? (
        <div className="bg-surface rounded-lg p-4 h-[120px] animate-pulse shadow-micro" />
      ) : error ? (
        <div className="bg-surface rounded-lg p-6 shadow-micro flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-negative-container flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-negative text-[24px]">error</span>
          </div>
          <p className="text-title-md text-on-surface">Failed to load orders</p>
          <p className="text-body-sm text-on-surface-variant mt-1">Please try again.</p>
          <button
            onClick={() => {}}
            className="mt-4 px-5 py-2.5 bg-primary text-on-primary rounded-full text-label-md active:scale-[0.97] transition-transform"
          >
            Retry
          </button>
        </div>
      ) : !orders || orders.length === 0 ? (
        <div className="bg-surface rounded-lg p-6 shadow-micro flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-primary text-[24px]">receipt_long</span>
          </div>
          <p className="text-title-md text-primary">No open orders</p>
          <p className="text-body-sm text-on-surface-variant mt-1">Orders will appear here after executing a proposal.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-lg p-4 shadow-micro flex flex-col gap-4">
          {orders.map((order, i) => {
            const kindLabel = order.kind === 'TAKE_PROFIT' ? 'TP' : order.kind === 'STOP_LOSS' ? 'SL' : order.kind === 'BUY_TRIGGER' ? 'BUY' : order.kind;
            const kindColor = order.kind === 'TAKE_PROFIT' ? 'text-positive' : order.kind === 'STOP_LOSS' ? 'text-negative' : 'text-on-surface';
            const icon = order.kind === 'BUY_TRIGGER' ? 'shopping_cart' : order.kind === 'TAKE_PROFIT' ? 'trending_up' : order.kind === 'STOP_LOSS' ? 'trending_down' : 'swap_vert';
            const ticker = order.ticker ?? order.assetId ?? order.positionId.slice(0, 8);
            const isBuyPending = order.kind === 'BUY_TRIGGER' && order.status === 'OPEN';
            const isEditable = (order.kind === 'TAKE_PROFIT' || order.kind === 'STOP_LOSS') && order.status === 'OPEN';
            return (
              <div
                key={order.id}
                className={`flex justify-between items-center ${i < orders.length - 1 ? 'pb-4 border-b border-divider' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="bg-surface-container-high text-on-surface w-10 h-10 rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">{icon}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-label-lg text-on-surface">{ticker}</span>
                      <span className={`text-label-md font-bold ${kindColor}`}>
                        {kindLabel}
                      </span>
                    </div>
                    <div className="text-body-sm text-on-surface-variant">
                      ${order.sizeUsd.toLocaleString()} {order.triggerPriceUsd ? `@ $${order.triggerPriceUsd.toLocaleString()}` : ''}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="bg-surface-container text-on-surface text-label-sm px-2 py-1 rounded-full">
                    {order.status}
                  </div>
                  {isBuyPending && (
                    <button className="text-label-sm text-negative px-3 py-1.5 rounded-full border border-negative/30 hover:bg-negative/10 transition-colors">
                      Cancel
                    </button>
                  )}
                  {isEditable && (
                    <button className="text-label-sm text-primary px-3 py-1.5 rounded-full border border-outline hover:bg-surface-dim transition-colors">
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.section>
  );
}
