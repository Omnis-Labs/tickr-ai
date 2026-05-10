'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { CheckCircle2, CircleAlert, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { WalletContextProvider } from '@/components/wallet/wallet-provider';

const NotificationClient = dynamic(
  () =>
    import('@/components/notifications/notification-client').then((mod) => mod.NotificationClient),
  { ssr: false },
);

const toastClassNames = {
  toast: 'hunch-toast',
  title: 'hunch-toast-title',
  description: 'hunch-toast-description',
  content: 'hunch-toast-content',
  icon: 'hunch-toast-icon',
  actionButton: 'hunch-toast-action',
  cancelButton: 'hunch-toast-cancel',
  closeButton: 'hunch-toast-close',
  default: 'hunch-toast-default',
  success: 'hunch-toast-success',
  error: 'hunch-toast-error',
  info: 'hunch-toast-info',
  warning: 'hunch-toast-warning',
  loading: 'hunch-toast-loading',
};

const toastIcons = {
  success: <CheckCircle2 aria-hidden="true" className="h-4 w-4" />,
  error: <CircleAlert aria-hidden="true" className="h-4 w-4" />,
  info: <Info aria-hidden="true" className="h-4 w-4" />,
  warning: <TriangleAlert aria-hidden="true" className="h-4 w-4" />,
  loading: <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />,
};

const toasterStyle = {
  '--width': 'min(420px, calc(100vw - 32px))',
} as CSSProperties;

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={qc}>
      <WalletContextProvider>
        {children}
        <NotificationClient />
        <Toaster
          theme="light"
          position="top-right"
          className="hunch-toaster"
          closeButton
          expand
          gap={12}
          visibleToasts={3}
          offset={{ top: 20, right: 20 }}
          mobileOffset={{ top: 16, right: 16, left: 16 }}
          style={toasterStyle}
          containerAriaLabel="Hunch It notifications"
          icons={toastIcons}
          toastOptions={{
            duration: 8_000,
            classNames: toastClassNames,
          }}
        />
      </WalletContextProvider>
    </QueryClientProvider>
  );
}
