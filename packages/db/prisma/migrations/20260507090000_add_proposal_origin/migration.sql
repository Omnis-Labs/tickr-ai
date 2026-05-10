-- Durable lineage for proposals created from the password-gated dev-tools
-- surface. Default keeps existing production proposals in the normal path.
CREATE TYPE "ProposalOrigin" AS ENUM ('SIGNAL_ENGINE', 'DEV_TOOLS');

ALTER TABLE "Proposal"
  ADD COLUMN "origin" "ProposalOrigin" NOT NULL DEFAULT 'SIGNAL_ENGINE';

CREATE INDEX "Proposal_origin_idx" ON "Proposal"("origin");
