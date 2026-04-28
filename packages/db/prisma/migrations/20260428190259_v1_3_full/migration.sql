-- CreateEnum
CREATE TYPE "ProposalAction" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SKIPPED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "ProposalOutcome" AS ENUM ('WIN', 'LOSS', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "SkipReason" AS ENUM ('TOO_RISKY', 'DISAGREE_THESIS', 'BAD_TIMING', 'ENOUGH_EXPOSURE', 'PRICE_NOT_ATTRACTIVE', 'TOO_MANY_PROPOSALS', 'OTHER');

-- CreateEnum
CREATE TYPE "PositionState" AS ENUM ('BUY_PENDING', 'ENTERING', 'ACTIVE', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('BUY_TRIGGER', 'TAKE_PROFIT', 'STOP_LOSS', 'CLOSE_SWAP');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'OPEN', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "TradeSource" AS ENUM ('BUY_APPROVAL', 'TP_FILL', 'SL_FILL', 'USER_CLOSE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "privyUserId" TEXT,
    "privyWalletId" TEXT,
    "walletAddress" TEXT NOT NULL,
    "delegationActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "holdingPeriod" TEXT NOT NULL,
    "maxDrawdown" DECIMAL(5,4),
    "maxTradeSize" DECIMAL(20,2) NOT NULL,
    "marketFocus" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "action" "ProposalAction" NOT NULL,
    "suggestedSizeUsd" DECIMAL(20,2) NOT NULL,
    "suggestedTriggerPrice" DECIMAL(20,8) NOT NULL,
    "suggestedTakeProfitPrice" DECIMAL(20,8) NOT NULL,
    "suggestedStopLossPrice" DECIMAL(20,8) NOT NULL,
    "rationale" TEXT NOT NULL,
    "reasoning" JSONB NOT NULL,
    "positionImpact" JSONB NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "priceAtProposal" DECIMAL(20,8) NOT NULL,
    "indicators" JSONB NOT NULL,
    "thesisTags" JSONB,
    "sourceBuyProposalId" TEXT,
    "positionId" TEXT,
    "triggeringTag" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedAt" TIMESTAMP(3),
    "priceAfter" DECIMAL(20,8),
    "pctChange" DECIMAL(8,4),
    "outcome" "ProposalOutcome",

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "reason" "SkipReason" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "tokenAmount" DECIMAL(30,9) NOT NULL,
    "entryPrice" DECIMAL(20,8) NOT NULL,
    "totalCost" DECIMAL(20,2) NOT NULL,
    "currentTpPrice" DECIMAL(20,8),
    "currentSlPrice" DECIMAL(20,8),
    "state" "PositionState" NOT NULL DEFAULT 'BUY_PENDING',
    "firstEntryAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "realizedPnl" DECIMAL(20,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "side" TEXT NOT NULL,
    "triggerPriceUsd" DECIMAL(20,8),
    "sizeUsd" DECIMAL(20,2) NOT NULL,
    "tokenAmount" DECIMAL(30,9),
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "jupiterOrderId" TEXT,
    "txSignature" TEXT,
    "executionPrice" DECIMAL(20,8),
    "filledAmount" DECIMAL(30,9),
    "filledAt" TIMESTAMP(3),
    "slippageBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "proposalId" TEXT,
    "ticker" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "source" "TradeSource" NOT NULL,
    "suggestedSizeUsd" DECIMAL(20,2),
    "suggestedTriggerPrice" DECIMAL(20,8),
    "suggestedTpPrice" DECIMAL(20,8),
    "suggestedSlPrice" DECIMAL(20,8),
    "actualSizeUsd" DECIMAL(20,2) NOT NULL,
    "actualTriggerPrice" DECIMAL(20,8),
    "actualTpPrice" DECIMAL(20,8),
    "actualSlPrice" DECIMAL(20,8),
    "executionPrice" DECIMAL(20,8),
    "filledAmount" DECIMAL(30,9),
    "realizedPnl" DECIMAL(20,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_privyUserId_key" ON "User"("privyUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_userId_key" ON "Mandate"("userId");

-- CreateIndex
CREATE INDEX "Proposal_userId_status_createdAt_idx" ON "Proposal"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Proposal_evaluatedAt_idx" ON "Proposal"("evaluatedAt");

-- CreateIndex
CREATE INDEX "Proposal_positionId_idx" ON "Proposal"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "Skip_userId_proposalId_key" ON "Skip"("userId", "proposalId");

-- CreateIndex
CREATE INDEX "Position_userId_state_idx" ON "Position"("userId", "state");

-- CreateIndex
CREATE INDEX "Position_userId_ticker_idx" ON "Position"("userId", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "Order_jupiterOrderId_key" ON "Order"("jupiterOrderId");

-- CreateIndex
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");

-- CreateIndex
CREATE INDEX "Order_positionId_idx" ON "Order"("positionId");

-- CreateIndex
CREATE INDEX "Trade_userId_createdAt_idx" ON "Trade"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_positionId_idx" ON "Trade"("positionId");

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skip" ADD CONSTRAINT "Skip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skip" ADD CONSTRAINT "Skip_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
