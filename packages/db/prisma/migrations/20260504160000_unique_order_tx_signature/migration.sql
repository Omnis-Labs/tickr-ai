-- Idempotency anchor for PositionLifecycle (ADR-0001 + C4).
-- Postgres unique indexes treat multiple NULLs as distinct, so existing
-- rows with txSignature = NULL are unaffected; only future fills must
-- carry distinct signatures.
CREATE UNIQUE INDEX "Order_txSignature_key" ON "Order"("txSignature");
