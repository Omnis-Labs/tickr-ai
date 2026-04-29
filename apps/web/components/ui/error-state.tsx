'use client';

import { motion } from 'framer-motion';

interface ErrorStateProps {
  icon?: string;
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  icon = 'error',
  title,
  message,
  onRetry,
  retryLabel = 'Try Again',
}: ErrorStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface rounded-lg p-6 shadow-micro flex flex-col items-center justify-center text-center"
    >
      <div className="w-12 h-12 rounded-full bg-negative-container flex items-center justify-center mb-3">
        <span className="material-symbols-outlined text-negative text-[24px]">{icon}</span>
      </div>
      <p className="text-title-md text-on-surface">{title}</p>
      <p className="text-body-sm text-on-surface-variant mt-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-5 py-2.5 bg-primary text-on-primary rounded-full text-label-md active:scale-[0.97] transition-transform"
        >
          {retryLabel}
        </button>
      )}
    </motion.div>
  );
}

/** Inline error banner for non-blocking errors */
export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="mx-5 mb-4 bg-negative-container rounded-lg px-5 py-3 flex items-center justify-between"
    >
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-negative text-[18px]">warning</span>
        <span className="text-body-sm text-negative">{message}</span>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-label-sm text-negative underline ml-3 shrink-0">
          Dismiss
        </button>
      )}
    </motion.div>
  );
}
