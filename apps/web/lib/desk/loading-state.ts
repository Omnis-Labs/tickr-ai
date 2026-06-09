interface DeskPortfolioLoadState {
  isLoading: boolean;
  isPending: boolean;
  hasData: boolean;
  hasError: boolean;
}

export function shouldShowDeskPortfolioLoading({
  isLoading,
  isPending,
  hasData,
  hasError,
}: DeskPortfolioLoadState): boolean {
  if (hasError) return false;
  return isLoading || isPending || !hasData;
}

interface DeskSectionLoadState {
  isLoading: boolean;
  isPending: boolean;
  hasError: boolean;
}

export function shouldShowDeskSectionLoading({
  isLoading,
  isPending,
  hasError,
}: DeskSectionLoadState): boolean {
  if (hasError) return false;
  return isLoading || isPending;
}
