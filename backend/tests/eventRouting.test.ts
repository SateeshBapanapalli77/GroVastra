import { describe, it, expect, beforeEach } from 'vitest';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignCustomerFactModel } from '../src/modules/campaigns/models/CampaignCustomerFact.model';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { CustomerProductRequestModel } from '../src/modules/crm/models/CustomerProductRequest.model';
import { processNextPendingEvent } from '../src/workers/events';
import { EVENT_REGISTRY, isKnownEventType, getEventDefinition, validateEventPayload } from '../src/shared/events/registry';
import { generateId } from '../src/shared/utils/id';

describe('Step 8: Domain Event Registry, Validation & Worker Routing', () => {
  const tenantId = 'qa_tenant_evroute';

  beforeEach(async () => {
    await Promise.all([
      CampaignModel.deleteMany({ tenantId }),
      CampaignVersionModel.deleteMany({ tenantId }),
      CampaignEnrollmentModel.deleteMany({ tenantId }),
      CampaignExecutionModel.deleteMany({ tenantId }),
      CampaignCustomerFactModel.deleteMany({ tenantId }),
      CampaignEventInboxModel.deleteMany({ tenantId }),
      CustomerModel.deleteMany({ tenantId }),
      CustomerProductRequestModel.deleteMany({ tenantId })
    ]);
  });

  async function createActiveCustomer(id: string = 'cus_01') {
    return CustomerModel.create({
      id,
      tenantId,
      firstName: 'Ananya',
      lastName: 'Rao',
      phone: '+919876543210',
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false
    });
  }

  async function createActiveCampaign(params: {
    campaignId: string;
    versionId: string;
    presetId?: string;
    name: string;
    trigger: any;
    purpose?: 'MARKETING' | 'ORDER_SERVICE';
    stepId?: string;
  }) {
    await CampaignModel.create({
      id: params.campaignId,
      tenantId,
      name: params.name,
      industry: 'BOUTIQUE',
      purpose: params.purpose || 'MARKETING',
      status: 'ACTIVE',
      activeVersionId: params.versionId,
      presetId: params.presetId || params.campaignId,
      draftVersion: 1,
      pauseGeneration: 0
    });

    const rawTrigger = params.trigger || {};
    const validTypes = ['ANNUAL_DATE', 'EVENT_DRIVEN', 'INACTIVITY_SCAN'];
    const triggerType = validTypes.includes(rawTrigger.type) ? rawTrigger.type : 'EVENT_DRIVEN';

    return CampaignVersionModel.create({
      id: params.versionId,
      tenantId,
      campaignId: params.campaignId,
      version: 1,
      name: params.name,
      industry: 'BOUTIQUE',
      purpose: params.purpose || 'MARKETING',
      trigger: {
        ...rawTrigger,
        type: triggerType
      },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: params.stepId || 'default_step',
          offsetDays: 0,
          localTime: '10:00',
          templateRef: { id: 'tpl_generic', revision: 1, language: 'en' },
          bindings: {},
          maxLatenessMinutes: 240
        }
      ],
      priority: 60,
      publishedBy: 'system',
      reviewFingerprint: `fp_${params.versionId}`
    });
  }

  describe('Registry & Validation Invariants', () => {
    it('recognizes all required domain event types in registry', () => {
      const requiredTypes = [
        'inventory.arrival',
        'festival.launch',
        'collection.released',
        'stockoffer.active',
        'order.completed',
        'order.refunded',
        'customer.vip_milestone',
        'credit.expiring',
        'exhibition.announced',
        'appointment.scheduled',
        'delivery.updated',
        'stock.published',
        'enquiry.received',
        'alteration.completed',
        'whatsapp.status.delivered'
      ];

      for (const type of requiredTypes) {
        expect(isKnownEventType(type)).toBe(true);
        expect(getEventDefinition(type)).toBeDefined();
      }
    });

    it('rejects unknown event types during payload validation', () => {
      const invalid = validateEventPayload({
        schemaVersion: 1,
        producer: 'unknown',
        type: 'unregistered.custom.event',
        entityId: 'ent_1',
        data: {}
      });

      expect(invalid.success).toBe(false);
      expect(invalid.error).toContain('UNKNOWN_EVENT_TYPE');
    });

    it('rejects incompatible payload schemas during payload validation', () => {
      const invalid = validateEventPayload({
        schemaVersion: 2, // Unsupported schema version
        producer: 'pos',
        type: 'order.completed',
        entityId: 'ord_1',
        data: {}
      });

      expect(invalid.success).toBe(false);
      expect(invalid.error).toContain('INCOMPATIBLE_SCHEMA');
    });
  });

  describe('Worker Event Dispatch & Replay Idempotence', () => {
    it('1. inventory.arrival: enrolls matching requests, replaying creates nothing new', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_merch_arr',
        versionId: 'cv_merch_arr',
        presetId: 'preset_merchandise_arrival',
        name: 'Merchandise Arrival',
        trigger: { type: 'STOCK_EVENT', field: 'arrival' }
      });

      await CustomerProductRequestModel.create({
        id: 'req_saree_01',
        tenantId,
        customerId: customer.id,
        preferredWeave: 'kanjeevaram',
        sku: 'SKU-KANJEE-RED',
        status: 'OPEN'
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'inventory',
        eventId: 'evt_inv_arr_01',
        type: 'inventory.arrival',
        entityId: 'SKU-KANJEE-RED',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { sku: 'SKU-KANJEE-RED', stockCount: 5, arrivalEventId: 'arr_fest_101' }
      });

      const processed = await processNextPendingEvent(tenantId);
      expect(processed?.status).toBe('PROCESSED');

      const enrollmentsCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const executionsCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrollmentsCount).toBe(1);
      expect(executionsCount).toBe(1);

      // Replaying the event
      event.status = 'RECEIVED';
      await event.save();

      await processNextPendingEvent(tenantId);
      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrollmentsCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(executionsCount);
    });

    it('2. festival.launch: enrolls active patrons, replaying creates nothing new', async () => {
      await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_festival',
        versionId: 'cv_festival',
        presetId: 'preset_festival_launch',
        name: 'Diwali Festive Launch',
        trigger: { type: 'STOCK_EVENT', eventType: 'festival.launch' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'inventory',
        eventId: 'evt_fest_01',
        type: 'festival.launch',
        entityId: 'diwali_2026',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { seasonId: 'diwali_2026' }
      });

      const processed = await processNextPendingEvent(tenantId);
      expect(processed?.status).toBe('PROCESSED');

      const enrollmentsCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const executionsCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrollmentsCount).toBe(1);
      expect(executionsCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrollmentsCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(executionsCount);
    });

    it('3. collection.released: enrolls active patrons, replaying creates nothing new', async () => {
      await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_collection',
        versionId: 'cv_collection',
        presetId: 'preset_collection_release',
        name: 'Bridal Kanjeevaram 2026',
        trigger: { type: 'STOCK_EVENT', eventType: 'collection.released' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'inventory',
        eventId: 'evt_coll_01',
        type: 'collection.released',
        entityId: 'bridal_2026',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { releaseId: 'bridal_2026' }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('4. stockoffer.active: enrolls active patrons, replaying creates nothing new', async () => {
      await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_stockoffer',
        versionId: 'cv_stockoffer',
        presetId: 'preset_stock_offer',
        name: 'Selected Silk Saree Offer',
        trigger: { type: 'STOCK_EVENT', eventType: 'stockoffer.active' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'inventory',
        eventId: 'evt_offer_01',
        type: 'stockoffer.active',
        entityId: 'offer_silk_fest',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { offerId: 'offer_silk_fest' }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('5. order.completed: updates facts, evaluates outfit and nurture triggers; replay creates nothing new', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_outfit',
        versionId: 'cv_outfit',
        presetId: 'preset_complete_outfit',
        name: 'Complete the Outfit',
        trigger: { type: 'ORDER_EVENT' }
      });

      await createActiveCampaign({
        campaignId: 'cmp_nurture',
        versionId: 'cv_nurture',
        presetId: 'preset_first_second_purchase',
        name: 'First to Second Purchase Nurture',
        trigger: { type: 'ORDER_EVENT' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'pos',
        eventId: 'evt_order_01',
        type: 'order.completed',
        entityId: 'ord_purch_101',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: {
          orderId: 'ord_purch_101',
          customerId: customer.id,
          netPaise: 4500000
        }
      });

      await processNextPendingEvent(tenantId);

      // Assert Facts Updated
      const fact = await CampaignCustomerFactModel.findOne({ tenantId, customerId: customer.id });
      expect(fact?.lastQualifyingOrderId).toBe('ord_purch_101');

      // Assert Outfit & Nurture Enrollments & Executions Created
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(2);
      expect(exeCount).toBe(2);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('6. order.refunded: calls handleOrderRefundFact to recompute customer facts', async () => {
      const customer = await createActiveCustomer();
      await CampaignCustomerFactModel.create({
        id: generateId('fact'),
        tenantId,
        customerId: customer.id,
        lastQualifyingOrderId: 'ord_refund_me',
        lastQualifyingPurchaseAt: new Date(),
        aggregateVersion: 1
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'pos',
        eventId: 'evt_refund_01',
        type: 'order.refunded',
        entityId: 'ord_refund_me',
        entityVersion: 2,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: {
          orderId: 'ord_refund_me',
          customerId: customer.id
        }
      });

      await processNextPendingEvent(tenantId);

      const refreshedFact = await CampaignCustomerFactModel.findOne({ tenantId, customerId: customer.id });
      expect(refreshedFact?.lastQualifyingOrderId).toBeNull();
      expect(refreshedFact?.aggregateVersion).toBe(2);
    });

    it('7. customer.vip_milestone: creates VIP enrollment and execution; replay is idempotent', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_vip',
        versionId: 'cv_vip',
        presetId: 'preset_vip_milestone',
        name: 'VIP Milestone Celebrations',
        trigger: { type: 'CUSTOMER_DATE', field: 'vip' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'crm',
        eventId: 'evt_vip_tier_01',
        type: 'customer.vip_milestone',
        entityId: customer.id,
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { customerId: customer.id, vipTier: 'DIAMOND' }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('8. credit.expiring: creates credit reminder enrollment and execution; replay is idempotent', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_credit',
        versionId: 'cv_credit',
        presetId: 'preset_credit_expiry',
        name: 'Store Credit Expiry Notice',
        trigger: { type: 'ORDER_EVENT' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'crm',
        eventId: 'evt_credit_exp_01',
        type: 'credit.expiring',
        entityId: 'crd_99',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { customerId: customer.id, creditId: 'crd_99' }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('9. exhibition.announced: creates trunk show invitation enrollment and execution; replay is idempotent', async () => {
      await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_exhib',
        versionId: 'cv_exhib',
        presetId: 'preset_exhibition_invite',
        name: 'Bangalore Trunk Show Preview',
        trigger: { type: 'STOCK_EVENT' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'crm',
        eventId: 'evt_exhib_01',
        type: 'exhibition.announced',
        entityId: 'show_blr_2026',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { showId: 'show_blr_2026' }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('10. appointment.scheduled: creates fitting appointment enrollment and execution; replay is idempotent', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_apt',
        versionId: 'cv_apt',
        presetId: 'preset_fitting_appointment',
        name: 'Bridal Blouse Fitting',
        purpose: 'ORDER_SERVICE',
        trigger: { eventType: 'appointment.scheduled' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'boutique.appointments',
        eventId: 'evt_apt_01',
        type: 'appointment.scheduled',
        entityId: 'apt_fit_99',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { appointmentId: 'apt_fit_99', customerId: customer.id }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('11. delivery.updated: creates out-for-delivery status enrollment and execution; replay is idempotent', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_deliv',
        versionId: 'cv_deliv',
        presetId: 'preset_delivery_status',
        name: 'Courier Delivery Tracker',
        purpose: 'ORDER_SERVICE',
        trigger: { eventType: 'delivery.updated' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'courier',
        eventId: 'evt_del_01',
        type: 'delivery.updated',
        entityId: 'ord_courier_88',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { orderId: 'ord_courier_88', customerId: customer.id, deliveryStatus: 'OUT_FOR_DELIVERY' }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('12. alteration.completed: creates alteration ready reminder enrollment and execution', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_alt',
        versionId: 'cv_alt',
        presetId: 'preset_alteration_ready',
        name: 'Custom Blouse Ready',
        purpose: 'ORDER_SERVICE',
        trigger: { eventType: 'alteration.completed' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'tailor',
        eventId: 'evt_alt_01',
        type: 'alteration.completed',
        entityId: 'job_alt_77',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { jobId: 'job_alt_77', customerId: customer.id, itemTitle: 'Zari Embroidered Blouse' }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('13. enquiry.received: creates enquiry consultation enrollment and execution', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_enq',
        versionId: 'cv_enq',
        presetId: 'preset_enquiry_followup',
        name: 'Patron Bridal Consultation',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'enquiry.received' }
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'crm',
        eventId: 'evt_enq_01',
        type: 'enquiry.received',
        entityId: 'enq_patron_44',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { customerId: customer.id, enquiryId: 'enq_patron_44' }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(2);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('14. stock.published: creates restock alert enrollment and execution', async () => {
      const customer = await createActiveCustomer();
      await createActiveCampaign({
        campaignId: 'cmp_restock',
        versionId: 'cv_restock',
        presetId: 'preset_restock_alert',
        name: 'Back in Stock Alert',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'stock.published' }
      });

      await CustomerProductRequestModel.create({
        id: 'req_restock_01',
        tenantId,
        customerId: customer.id,
        sku: 'SKU-BANARASI-GOLD',
        preferredWeave: 'banarasi',
        status: 'OPEN'
      });

      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'inventory',
        eventId: 'evt_stock_pub_01',
        type: 'stock.published',
        entityId: 'SKU-BANARASI-GOLD',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { sku: 'SKU-BANARASI-GOLD', stockCount: 3 }
      });

      await processNextPendingEvent(tenantId);
      const enrCount = await CampaignEnrollmentModel.countDocuments({ tenantId });
      const exeCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrCount).toBe(1);
      expect(exeCount).toBe(1);

      // Replay
      event.status = 'RECEIVED';
      await event.save();
      await processNextPendingEvent(tenantId);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId })).toBe(enrCount);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(exeCount);
    });

    it('15. Unknown event types go to QUARANTINE with a visible reason in worker', async () => {
      const event = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId,
        producer: 'alien_system',
        eventId: 'evt_unknown_99',
        type: 'mystery.unsupported_trigger',
        entityId: 'obj_99',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: {}
      });

      const processed = await processNextPendingEvent(tenantId);
      expect(processed).not.toBeNull();
      expect(processed?.status).toBe('QUARANTINE');
      expect(processed?.errorMessage).toContain('UNKNOWN_EVENT_TYPE');

      const saved = await CampaignEventInboxModel.findOne({ tenantId, eventId: 'evt_unknown_99' });
      expect(saved?.status).toBe('QUARANTINE');
      expect(saved?.errorMessage).toContain('UNKNOWN_EVENT_TYPE');
    });
  });
});
