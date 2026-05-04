-- Idempotency anchor for PositionLifecycle (ADR-0001 + C4).
-- Postgres unique indexes treat multiple NULLs as distinct, so existing
-- rows with txSignature = NULL are unaffected; only future fills must
-- carry distinct signatures.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Order"
    WHERE "txSignature" IS NOT NULL
    GROUP BY "txSignature"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate non-null Order.txSignature values exist; refusing to add unique index';
  END IF;
END $$;
CREATE UNIQUE INDEX "Order_txSignature_key" ON "Order"("txSignature");
