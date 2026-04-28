import type { Prisma } from '@hunch-it/db';

/**
 * Prisma's Decimal columns return a Decimal *object* on read. The frontend
 * expects plain `number` on prices / sizes / PnL (it does `.toFixed()`,
 * arithmetic, comparisons), so every API route serializes through the
 * helpers below before NextResponse.json().
 *
 * Why not just .toString() everywhere? Decimal.toJSON() emits a string,
 * which would break consumers like `position.entryPrice.toFixed(2)` —
 * silently turning prices into "12.30000000".toFixed at runtime.
 */

export function decToNum<T extends Prisma.Decimal | null | undefined>(
  v: T,
): T extends Prisma.Decimal ? number : null {
  if (v == null) return null as never;
  return v.toNumber() as never;
}

function isDecimal(v: unknown): v is Prisma.Decimal {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { toNumber?: unknown }).toNumber === 'function' &&
    typeof (v as { d?: unknown }).d !== 'undefined' // duck-type: decimal.js shape
  );
}

/**
 * Recursively convert any Decimal in a plain Prisma row (or array of rows)
 * to number. Dates and other values pass through untouched. Use this on the
 * boundary right before NextResponse.json().
 */
export function decimalsToNumbers<T>(value: T): T {
  if (value == null) return value;
  if (isDecimal(value)) return value.toNumber() as unknown as T;
  if (Array.isArray(value)) return value.map((v) => decimalsToNumbers(v)) as unknown as T;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = decimalsToNumbers(v);
    }
    return out as T;
  }
  return value;
}
