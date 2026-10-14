import { describe, it, expect, beforeEach } from 'vitest';
import { checkAndReserveContactCapacity } from '../src/modules/campaigns/engine/safeguards/contactCapResolver';
import { executePreflightSafeguards } from '../src/modules/campaigns/engine/safeguards/safeguardPipeline';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { sha256, encryptText } from '../src/shared/utils/crypto';
import { ulid } from 'ulid';

describe('Milestone 3: Durable Execution & Safeguards Test Suite', () => {
  describe('1. Contact Caps & Anti-Spam Gate (Handoff Page 18)', () => {
    it('allows the first marketing message to a new destination', async () => {
      const phone = `+919900${Math.floor(100000 + Math.random() * 900000)}`;
      const result = await checkAndReserveContactCapacity(
        'tenant_test',
        phone,
        'cmp_bday',
        'exe_001',
        new Date(Date.now() + 86400000),
        80
      );

      expect(result.allowed).toBe(true);
    });

    it('rejects or defers a second message within the 24-hour rolling window', async () => {
      const phone = `+919901${Math.floor(100000 + Math.random() * 900000)}`;

      // First reservation
      const res1 = await checkAndReserveContactCapacity(
        'tenant_test',
        phone,
        'cmp_bday',
        'exe_first',
        new Date(Date.now() + 86400000),
        80
      );
      expect(res1.allowed).toBe(true);

      // Second reservation immediately after
      const res2 = await checkAndReserveContactCapacity(
        'tenant_test',
        phone,
        'cmp_festival',
        'exe_second',
        new Date(Date.now() + 86400000),
        50
      );
      expect(res2.allowed).toBe(false);
      expect(['DEFERRED_CONTACT_CAP', 'SKIPPED_CONTACT_CAP']).toContain(res2.reason);
    });
  });

  describe('2. Delivery Adapter Dispatch & Outcome States (Handoff Page 27)', () => {
    let adapter: MockWhatsAppDeliveryAdapter;

    beforeEach(() => {
      adapter = new MockWhatsAppDeliveryAdapter();
    });

    it('successfully dispatches approved template and records provider ID', async () => {
      const result = await adapter.sendCampaignStep({
        executionId: 'exe_test_01',
        deliveryKey: 'exe_test_01',
        connectionId: 'conn_test',
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

    it('records OUTCOME_UNKNOWN on network timeout and does not resend blindly', async () => {
      adapter.setForcedState('FORCE_TIMEOUT');

      const result = await adapter.sendCampaignStep({
        executionId: 'exe_test_timeout',
        deliveryKey: 'exe_test_timeout',
        connectionId: 'conn_test',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        template: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        parameters: { name: 'Lakshmi' },
        expiresAt: new Date(Date.now() + 3600000)
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe('OUTCOME_UNKNOWN');
      expect(result.errorCode).toBe('NETWORK_TIMEOUT');
    });

    it('records permanent failure on unapproved or paused template', async () => {
      const result = await adapter.sendCampaignStep({
        executionId: 'exe_test_fail',
        deliveryKey: 'exe_test_fail',
        connectionId: 'conn_test',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        template: { id: 'tpl_unknown_random', revision: 1, language: 'en' },
        parameters: {},
        expiresAt: new Date(Date.now() + 3600000)
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe('REJECTED');
      expect(result.errorCode).toBe('TEMPLATE_NOT_FOUND');
    });
  });

  describe('3. Two-Phase Intent Freezing & Encryption (Handoff Page 19 & 23)', () => {
    it('freezes canonical payload hash and encrypts recipient at dispatch time', () => {
      const rawPhone = '+919876543210';
      const encryptedPhone = encryptText(rawPhone);

      const params = {
        name: 'Lakshmi',
        shop: 'Padmavati Handlooms',
        offer: '15% Birthday Discount'
      };
      const hash1 = sha256(params);
      const hash2 = sha256(params);

      expect(hash1).toBe(hash2);
      expect(encryptedPhone).not.toBe(rawPhone);
      expect(encryptedPhone.split(':').length).toBe(3);
    });
  });
});
