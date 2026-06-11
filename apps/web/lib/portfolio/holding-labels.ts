export function formatHoldingStateForDisplay(state: string): string {
  if (state === 'BUY_PENDING') return 'Waiting for entry';
  if (state === 'ENTERING') return 'Entering';
  if (state === 'CLOSING') return 'Closing';
  if (state === 'CLOSED') return 'Closed';
  return 'Active';
}
