import { toJson, type Db } from './db.js';

export const DOMAIN_EVENTS = {
  TRANSACTION_STATUS_CHANGED: 'TRANSACTION_STATUS_CHANGED',
  /** Consumed by a future downstream integration (ERP/RPA). Not consumed in this application. */
  TRANSACTION_READY_FOR_PROCESSING: 'TRANSACTION_READY_FOR_PROCESSING',
} as const;
export type DomainEventType = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

/** Transactional outbox: must be called with the same transaction client as the state change. */
export async function publishDomainEvent(
  db: Db,
  event: { type: DomainEventType; aggregateType: string; aggregateId: string; payload: unknown },
): Promise<void> {
  await db.domainEvent.create({
    data: {
      eventType: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: toJson(event.payload),
    },
  });
}
