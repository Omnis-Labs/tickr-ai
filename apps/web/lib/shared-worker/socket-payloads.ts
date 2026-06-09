import { TriggerHitPayloadSchema, type TriggerHitPayload } from '@hunch-it/shared';

export function parseTriggerHitSocketPayload(payload: unknown): TriggerHitPayload | null {
  const parsed = TriggerHitPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  return parsed.data;
}
