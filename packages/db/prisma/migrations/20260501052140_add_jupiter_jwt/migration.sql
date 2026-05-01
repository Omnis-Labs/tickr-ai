-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "jupiterJwt" TEXT,
  ADD COLUMN "jupiterJwtExpiresAt" TIMESTAMP(3);
