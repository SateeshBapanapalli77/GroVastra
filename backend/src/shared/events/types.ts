export interface DomainEvent<T = any> {
  schemaVersion: number;
  producer: 'orders' | 'inventory' | 'crm' | 'whatsapp' | 'manual';
  eventId: string;
  tenantId: string;
  type: string;
  entityId: string;
  entityVersion: number;
  occurredAt: Date;
  receivedAt: Date;
  customerId?: string;
  data: T;
}

export type EventHandler<T = any> = (event: DomainEvent<T>) => Promise<void>;
