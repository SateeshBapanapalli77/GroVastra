import { describe, it, expect, beforeEach } from 'vitest';
import { generateId } from '../src/shared/utils/id';
import { encryptText, decryptText, sha256 } from '../src/shared/utils/crypto';
import {
  SettableTestClock,
  resolveNextAnnualOccurrence,
  calculateDueInstant
} from '../src/shared/utils/clock';
import { APPROVED_TEMPLATES, getApprovedTemplate } from '../src/modules/campaigns/adapters/templateCatalogue';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { DomainEventBus } from '../src/shared/events/eventBus';

describe('Milestone 1 Foundation Test Suite', () => {
  describe('1. Prefixed ID Generator', () => {
    it('generates IDs with expected domain prefixes', () => {
      const cmpId = generateId('cmp');
      const enrId = generateId('enr');
      const exeId = generateId('exe');
      const diId = generateId('di');

      expect(cmpId).toMatch(/^cmp_[0-9a-z]{26}$/);
      expect(enrId).toMatch(/^enr_[0-9a-z]{26}$/);
      expect(exeId).toMatch(/^exe_[0-9a-z]{26}$/);
      expect(diId).toMatch(/^di_[0-9a-z]{26}$/);
    });
  });

  describe('2. Security & Encryption (AES-256-GCM & SHA-256)', () => {
    it('encrypts and decrypts recipient phone numbers losslessly', () => {
      const phone = '+919876543210';
      const encrypted = encryptText(phone);

      expect(encrypted).not.toBe(phone);
      expect(encrypted.split(':').length).toBe(3); // iv:tag:data

      const decrypted = decryptText(encrypted);
      expect(decrypted).toBe(phone);
    });

    it('generates consistent SHA-256 hashes for canonical payloads', () => {
      const payload = { customerId: 'cus_001', template: 'tpl_birthday_invite' };
      const hash1 = sha256(payload);
      const hash2 = sha256(payload);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  describe('3. Clock & Leap-Day Occasion Math (Luxon)', () => {
    it('resolves annual birthday for upcoming date in current year', () => {
      // Clock set to 14 October 2026
      const clock = new SettableTestClock('2026-10-14T10:00:00.000Z');
      const occ = resolveNextAnnualOccurrence(10, 28, 'Asia/Kolkata', 'FEB_28', clock);

      expect(occ.localDate).toBe('2026-10-28');
      expect(occ.occurrenceYear).toBe(2026);
      expect(occ.occurrenceId).toBe('2026');
    });

    it('resolves annual birthday to next year when date has already passed', () => {
      // Clock set to 14 October 2026, birthday was 5 January
      const clock = new SettableTestClock('2026-10-14T10:00:00.000Z');
      const occ = resolveNextAnnualOccurrence(1, 5, 'Asia/Kolkata', 'FEB_28', clock);

      expect(occ.localDate).toBe('2027-01-05');
      expect(occ.occurrenceYear).toBe(2027);
      expect(occ.occurrenceId).toBe('2027');
    });

    it('handles Feb 29 on non-leap year using FEB_28 policy', () => {
      // 2027 is not a leap year
      const clock = new SettableTestClock('2027-01-01T10:00:00.000Z');
      const occ = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'FEB_28', clock);

      expect(occ.localDate).toBe('2027-02-28');
      expect(occ.occurrenceYear).toBe(2027);
    });

    it('handles Feb 29 on non-leap year using MAR_01 policy', () => {
      const clock = new SettableTestClock('2027-01-01T10:00:00.000Z');
      const occ = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'MAR_01', clock);

      expect(occ.localDate).toBe('2027-03-01');
      expect(occ.occurrenceYear).toBe(2027);
    });

    it('calculates due instant with offset and timezone correctly', () => {
      // Occasion: 2027-01-05, offset: -14 days, time: 10:00 IST
      // 2027-01-05 minus 14 days = 2026-12-22 10:00 IST = 2026-12-22 04:30:00 UTC (Page 23 Example!)
      const due = calculateDueInstant('2027-01-05', -14, '10:00', 'Asia/Kolkata');

      expect(due.localDate).toBe('2026-12-22');
      expect(due.localTime).toBe('10:00');
      expect(due.dueAtUtc.toISOString()).toBe('2026-12-22T04:30:00.000Z');
    });
  });

  describe('4. Approved Templates & Mock Delivery Adapter', () => {
    let adapter: MockWhatsAppDeliveryAdapter;

    beforeEach(() => {
      adapter = new MockWhatsAppDeliveryAdapter();
    });

    it('has all required boutique templates in the approved catalogue', () => {
      const tpl = getApprovedTemplate('tpl_birthday_invite');
      expect(tpl).toBeDefined();
      expect(tpl?.status).toBe('APPROVED');
      expect(tpl?.category).toBe('MARKETING');

      const rendered = tpl?.render({ name: 'Lakshmi', shop: 'Padmavati Handlooms' });
      expect(rendered).toContain('Lakshmi');
      expect(rendered).toContain('Padmavati Handlooms');
    });

    it('dispatches step through mock adapter and increments call count', async () => {
      const result = await adapter.sendCampaignStep({
        executionId: 'exe_001',
        deliveryKey: 'exe_001',
        connectionId: 'conn_padmavati',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        template: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        parameters: { name: 'Lakshmi', shop: 'Padmavati Handlooms' },
        expiresAt: new Date(Date.now() + 3600000)
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe('ACCEPTED');
      expect(result.providerMessageId).toMatch(/^wamid\./);
      expect(adapter.getSubmissionCount()).toBe(1);
    });

    it('rejects dispatch for unapproved template with TEMPLATE_NOT_FOUND', async () => {
      const result = await adapter.sendCampaignStep({
        executionId: 'exe_002',
        deliveryKey: 'exe_002',
        connectionId: 'conn_padmavati',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        template: { id: 'tpl_non_existent', revision: 1, language: 'en' },
        parameters: {},
        expiresAt: new Date(Date.now() + 3600000)
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe('REJECTED');
      expect(result.errorCode).toBe('TEMPLATE_NOT_FOUND');
    });
  });

  describe('5. In-Process Domain Event Bus', () => {
    it('publishes and receives domain events between modules', async () => {
      const bus = new DomainEventBus();
      const received: any[] = [];

      bus.subscribe('order.completed', async (evt) => {
        received.push(evt);
      });

      await bus.publish({
        schemaVersion: 1,
        producer: 'orders',
        eventId: 'evt_test_01',
        tenantId: 'shop_padmavati',
        type: 'order.completed',
        entityId: 'ord_101',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: { netPaise: 500000 }
      });

      expect(received.length).toBe(1);
      expect(received[0].entityId).toBe('ord_101');
      expect(received[0].data.netPaise).toBe(500000);
    });
  });
});
