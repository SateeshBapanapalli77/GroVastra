import { DomainEvent, EventHandler } from './types';
import { logger } from '../../config/logger';

export class DomainEventBus {
  private handlers: Map<string, EventHandler[]> = new Map();

  /**
   * Subscribe a handler to a specific event type (e.g. 'order.completed', 'stock.published')
   */
  subscribe<T = any>(eventType: string, handler: EventHandler<T>): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler as EventHandler);
    this.handlers.set(eventType, existing);
    logger.debug({ eventType }, 'Subscribed handler to domain event');
  }

  /**
   * Publish a domain event to all registered in-process subscribers
   */
  async publish<T = any>(event: DomainEvent<T>): Promise<void> {
    const subscribers = this.handlers.get(event.type) || [];
    const wildcardSubscribers = this.handlers.get('*') || [];
    const allHandlers = [...subscribers, ...wildcardSubscribers];

    logger.info(
      { eventId: event.eventId, type: event.type, tenantId: event.tenantId, subscriberCount: allHandlers.length },
      'Publishing domain event'
    );

    // Execute handlers safely (catch individual handler errors without crashing bus)
    for (const handler of allHandlers) {
      try {
        await handler(event);
      } catch (error) {
        logger.error(
          { err: error, eventId: event.eventId, type: event.type },
          'Error in domain event handler'
        );
      }
    }
  }
}

export const eventBus = new DomainEventBus();
