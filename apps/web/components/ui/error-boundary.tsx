'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-negative-container flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-[32px] text-negative">error</span>
          </div>
          <h2 className="text-title-lg text-on-surface mb-2">Something went wrong</h2>
          <p className="text-body-md text-on-surface-variant mb-6">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-6 py-3 bg-primary text-on-primary rounded-full text-label-lg"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
