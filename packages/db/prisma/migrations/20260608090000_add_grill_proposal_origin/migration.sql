ALTER TYPE "ProposalOrigin" ADD VALUE 'GRILL';

ALTER TABLE "Proposal" ADD COLUMN "originContext" JSONB;
