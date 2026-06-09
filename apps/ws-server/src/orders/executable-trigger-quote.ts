import {
  executableTriggerDecision,
  getAssetById,
  getUltraOrderProblem,
  type ExecutableTriggerDecision,
  type TriggerWakePayload,
} from '@hunch-it/shared';
import { prepareInputAmount, requestUltraOrder } from '@hunch-it/execution';

export type QuoteExecutableTrigger = (input: {
  walletAddress: string;
  payload: TriggerWakePayload;
}) => Promise<ExecutableTriggerDecision>;

export async function quoteExecutableTrigger(input: {
  walletAddress: string;
  payload: TriggerWakePayload;
}): Promise<ExecutableTriggerDecision> {
  const asset = getAssetById(input.payload.ticker);
  if (!asset) {
    throw new Error(`asset_missing_decimals:${input.payload.ticker}`);
  }

  const plan = await prepareInputAmount({
    payload: input.payload,
    decimals: asset.decimals,
    walletAddress: input.walletAddress,
  });
  const order = await requestUltraOrder({
    inputMint: plan.inputMint,
    outputMint: plan.outputMint,
    amount: plan.amount,
    taker: input.walletAddress,
  });
  const problem = getUltraOrderProblem(order);
  if (problem) {
    throw new Error(problem.message);
  }

  return executableTriggerDecision({
    payload: input.payload,
    inAmount: order.inAmount,
    outAmount: order.outAmount,
    decimals: asset.decimals,
    jupiterRequestId: order.requestId,
  });
}
