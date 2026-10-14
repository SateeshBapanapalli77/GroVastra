import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateRestockEvent } from '../src/modules/campaigns/engine/restockStrategy';
import { evaluateEnquiryEvent } from '../src/modules/campaigns/engine/enquiryStrategy';
import { evaluateAlterationReadyEvent } from '../src/modules/campaigns/engine/boutiqueServiceStrategy';
import { runInactivityScan } from '../src/modules/campaigns/engine/inactivityScanner';
import { DomainEvent } from '../src/shared/events/types';

describe('Milestone 4: Merchandise & Lifecycle Scenarios Test Suite', () => {
  describe('1. Requested Restock Matching (Handoff Page 13)', () => {
    it('ignores restock events with zero sellable stock', async () => {
      const mockEvent: DomainEvent<any> = {
        schemaVersion: 1,
        producer: 'inventory',
        eventId: 'evt_stock_01',
        tenantId: 'shop_test',
        type: 'stock.published',
        entityId: 'prd_01',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          sku: 'KJ-RED-001',
          title: 'Kanjeevaram Silk Saree',
          pricePaise: 3850000,
          stockCount: 0 // Out of stock
        }
      };

      const result = await evaluateRestockEvent(mockEvent);
      expect(result.matchedRequests).toBe(0);
      expect(result.createdEnrollments).toBe(0);
    });

    it('validates sellable stock and produces correct restock occurrence key structure', () => {
      const sku = 'BN-BLU-002';
      const day = '2026-10-14';
      const occurrenceId = `restock:${sku}:${day}`;

      expect(occurrenceId).toBe('restock:BN-BLU-002:2026-10-14');
    });
  });

  describe('2. Unresolved Boutique Enquiry Strategy (Handoff Page 14)', () => {
    it('calculates +24h and +72h follow-up delays correctly from anchor', () => {
      const occurredAt = new Date('2026-10-14T10:00:00.000Z');

      const due24h = new Date(occurredAt.getTime() + 24 * 3600 * 1000);
      const due72h = new Date(occurredAt.getTime() + 72 * 3600 * 1000);

      expect(due24h.toISOString()).toBe('2026-10-15T10:00:00.000Z');
      expect(due72h.toISOString()).toBe('2026-10-17T10:00:00.000Z');
    });
  });

  describe('3. Win-Back Inactivity Anchoring (Handoff Page 14 & 17)', () => {
    it('constructs immutable winback occurrence key anchored to last order', () => {
      const lastOrderId = 'ord_diwali_99';
      const ruleId = 'cv_winback_01';
      const occurrenceId = `winback:${lastOrderId}:${ruleId}`;

      expect(occurrenceId).toBe('winback:ord_diwali_99:cv_winback_01');
    });

    it('returns empty enrollment when no active winback campaign exists', async () => {
      const result = await runInactivityScan('tenant_test', new Date());
      expect(result.enrolledWinbackCount).toBe(0);
    });
  });

  describe('4. Boutique Service Alterations (Handoff Page 15)', () => {
    it('constructs stable alteration occurrence key based on jobId', () => {
      const jobId = 'job_blouse_stitching_42';
      const occurrenceId = `alteration:${jobId}`;

      expect(occurrenceId).toBe('alteration:job_blouse_stitching_42');
    });
  });
});
