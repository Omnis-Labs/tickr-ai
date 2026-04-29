import { ReactNode } from 'react';

interface TopAppBarProps {
  title?: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
}

export function TopAppBar({ title, leftAction, rightAction }: TopAppBarProps) {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between min-h-16 px-5 pt-[env(safe-area-inset-top)] bg-background">
      <div className="flex items-center justify-start min-w-[44px]">
        {leftAction}
      </div>
      
      {title && (
        <h1 className="text-title-lg text-on-background font-semibold text-center flex-1">
          {title}
        </h1>
      )}
      
      <div className="flex items-center justify-end min-w-[44px]">
        {rightAction}
      </div>
    </header>
  );
}
