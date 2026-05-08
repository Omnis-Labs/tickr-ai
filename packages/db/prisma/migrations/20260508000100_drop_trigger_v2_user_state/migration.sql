-- Drop user-level state from the removed conditional-order and delegated-
-- signing experiments. The synthetic order model keeps Order.jupiterOrderId
-- only as a vestigial nullable column; no user auth or server-signer state is
-- part of the live schema.
ALTER TABLE "User"
  DROP COLUMN IF EXISTS "privyWalletId",
  DROP COLUMN IF EXISTS "delegationActive",
  DROP COLUMN IF EXISTS "jupiterJwt",
  DROP COLUMN IF EXISTS "jupiterJwtExpiresAt";
