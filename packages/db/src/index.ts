export { prisma, shutdownPrisma } from './client.js';
export {
  buildCreateBuyProposalForUserInput,
  buildBuyProposalCreateData,
  buildProposalCreationMandate,
  buildProposalCreationPositionImpact,
  createBuyProposalForUser,
} from './lifecycle/proposal-creation.js';
export {
  buildProposalSizeRationale,
  suggestBuyProposalSizeUsd,
} from './lifecycle/proposal-sizing.js';
export type {
  BuyMarketAnalysis,
  CreateBuyProposalForUserAdapterInput,
  CreateBuyProposalForUserInput,
  ProposalAnalysisIndicators,
  ProposalCreationMandate,
  ProposalCreationMandateInput,
  ProposalCreationPositionImpact,
  ProposalCreationPositionImpactInput,
} from './lifecycle/proposal-creation.js';
export type { ProposalSizingInput } from './lifecycle/proposal-sizing.js';
export {
  acceptBuyProposal,
  cancelOpenOrder,
  cancelPendingBuy,
  claimOrderExecution,
  confirmBuyFill,
  confirmExitFill,
  confirmSellProposalClose,
  placeProtectionOrder,
  releaseOrderExecutionClaim,
  userCloseActive,
  replaceProtectionOrders,
  LifecycleInvariantError,
} from './lifecycle/position-lifecycle.js';
export { expireActiveProposals } from './lifecycle/proposal-expiration.js';
export type { LifecycleStatus, LifecycleResult } from './lifecycle/position-lifecycle.js';
export type {
  Prisma,
  PrismaClient,
  ProposalAction,
  ProposalOutcome,
  ProposalStatus,
  PositionState,
  OrderKind,
  OrderStatus,
  TradeSource,
  SkipReason,
  User,
  Mandate,
  Proposal,
  Skip,
  Position,
  Order,
  Trade,
} from '../generated/prisma/index.js';
