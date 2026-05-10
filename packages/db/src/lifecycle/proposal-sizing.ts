export interface ProposalSizingInput {
  availableUsdc: number;
  maxTradeSizeUsd: number;
}

const MIN_SUGGESTED_SIZE_USD = 5;
const ROUND_INCREMENT_USD = 5;

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function suggestBuyProposalSizeUsd(input: ProposalSizingInput): number {
  const availableUsdc = finitePositive(input.availableUsdc);
  const maxTradeSizeUsd = finitePositive(input.maxTradeSizeUsd);
  if (availableUsdc === 0 || maxTradeSizeUsd === 0) return 0;

  const rawTarget = availableUsdc * 0.2;
  const balanceSized =
    rawTarget < MIN_SUGGESTED_SIZE_USD
      ? Math.min(availableUsdc, MIN_SUGGESTED_SIZE_USD)
      : Math.ceil(rawTarget / ROUND_INCREMENT_USD) * ROUND_INCREMENT_USD;

  return Number(Math.min(balanceSized, availableUsdc, maxTradeSizeUsd).toFixed(2));
}

export function buildProposalSizeRationale(
  input: ProposalSizingInput & { sizeUsd: number },
): string {
  return (
    `Size $${input.sizeUsd.toFixed(2)} is based on your $${finitePositive(input.availableUsdc).toFixed(2)} USDC balance ` +
    `and is within your $${finitePositive(input.maxTradeSizeUsd).toFixed(2)} max trade size.`
  );
}
