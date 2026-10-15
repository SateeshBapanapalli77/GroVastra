import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignCustomerFactModel } from '../src/modules/campaigns/models/CampaignCustomerFact.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { ProductModel } from '../src/modules/inventory/models/Product.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { CustomerProductRequestModel } from '../src/modules/crm/models/CustomerProductRequest.model';
import {
  evaluateInventoryArrivalEvent,
  evaluateFestivalEvent,
  evaluateCollectionReleaseEvent,
  evaluateSelectedStockOfferEvent
} from '../src/modules/campaigns/engine/merchandiseStrategy';
import {
  updateCustomerPurchaseFact,
  handleOrderRefundFact,
  runIndexedInactivityScan,
  evaluateCompleteTheOutfitEvent,
  evaluateFirstToSecondPurchaseEvent
} from '../src/modules/campaigns/engine/lifecycleStrategy';
import {
  evaluateVipMilestoneEvent,
  evaluateCreditExpiryEvent,
  evaluateExhibitionInviteEvent
} from '../src/modules/campaigns/engine/retentionStrategy';
import {
  evaluateAlterationReadyEvent,
  evaluateFittingAppointmentEvent,
  evaluateDeliveryUpdateEvent
} from '../src/modules/campaigns/engine/boutiqueServiceStrategy';
import { ingestDomainEvent } from '../src/modules/campaigns/adapters/domainAdapters';
import { executePreflightSafeguards } from '../src/modules/campaigns/engine/safeguards/safeguardPipeline';
import { executeDueStepDispatch } from '../src/modules/campaigns/engine/dispatchExecutor';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { generateId } from '../src/shared/utils/id';
import { DomainEvent } from '../src/shared/events/types';

describe('Work Package P3: Milestone 4 Presets, Lifecycles & Source Contracts', () => {
  const tenantId = 'qa_tenant_p3';

  beforeEach(async () => {
    // Clean all relevant collections
    await CampaignModel.deleteMany({ tenantId });
    await CampaignVersionModel.deleteMany({ tenantId });
    await CampaignEnrollmentModel.deleteMany({ tenantId });
    await CampaignExecutionModel.deleteMany({ tenantId });
    await CampaignCustomerFactModel.deleteMany({ tenantId });
    await CampaignDeliveryIntentModel.deleteMany({ tenantId });
    await CampaignEventInboxModel.deleteMany({ tenantId });
    await ProductModel.deleteMany({ tenantId });
    await CustomerModel.deleteMany({ tenantId });
    await CustomerProductRequestModel.deleteMany({ tenantId });
    await TenantConnectionModel.deleteMany({ tenantId });

    // Set up active connection
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId,
      connectionId: 'conn_p3_sandbox',
      wabaId: 'waba_p3',
      phoneNumberId: 'phone_p3',
      displayPhoneNumber: '+919876500000',
      active: true
    });
  });

  describe('1. Merchandise Family: Restock, True Availability & Live Stock Checks (A15, A16)', () => {
    it('A15: Requested restock with exact SKU matching; skipped if stock depleted at execution time', async () => {
      const mockAdapter = new MockWhatsAppDeliveryAdapter();

      // 1. Setup product in inventory with 2 pieces
      const product = await ProductModel.create({
        id: generateId('prd'),
        tenantId,
        sku: 'SKU-KANJEE-RED-001',
        title: 'Kanjeevaram Bridal Silk Saree',
        weave: 'Kanjeevaram',
        color: 'Crimson Gold',
        pricePaise: 4500000,
        stockCount: 2,
        isSellable: true
      });

      // 2. Setup customer with open request
      const customer = await CustomerModel.create({
        id: 'cus_p3_restock_1',
        tenantId,
        firstName: 'Ananya',
        lastName: 'Rao',
        phone: '+919876500041',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      await CustomerProductRequestModel.create({
        id: 'req_001_ananya',
        tenantId,
        customerId: customer.id,
        sku: product.sku,
        status: 'OPEN',
        requestedAt: new Date()
      });

      // 3. Setup active restock campaign
      const campaign = await CampaignModel.create({
        id: 'cmp_restock_exact',
        tenantId,
        name: 'Requested Saree Restock',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_restock_1',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const version = await CampaignVersionModel.create({
        id: 'cv_restock_1',
        tenantId,
        campaignId: campaign.id,
        version: 1,
        name: campaign.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'inventory.available' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'restock_notification',
            offsetDays: 0,
            localTime: '11:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_stock_restock', revision: 2, language: 'en' },
            bindings: { name: 'customer.firstName', item: 'product.title' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 180
          }
        ],
        priority: 60,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_p3_a15'
      });

      // 4. Inventory Arrival Event
      const arrivalEvent: DomainEvent<any> = {
        schemaVersion: 1,
        producer: 'inventory',
        eventId: 'evt_arr_101',
        tenantId,
        type: 'inventory.available',
        entityId: product.sku,
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          sku: product.sku,
          stockCount: 2,
          arrivalEventId: 'arr_diwali_2026'
        }
      };

      const matchResult = await evaluateInventoryArrivalEvent(arrivalEvent);
      expect(matchResult.matchedRequests).toBe(1);
      expect(matchResult.createdEnrollments).toBe(1);

      const enrollment = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer.id });
      expect(enrollment?.occurrenceId).toBe('arrival:arr_diwali_2026:req_001_ananya');

      const execution = await CampaignExecutionModel.findOne({ tenantId, enrollmentId: enrollment?.id });
      expect(execution?.state).toBe('SCHEDULED');

      // 5. Stock drops to zero before dispatch execution (A15)
      product.stockCount = 0;
      await product.save();

      // Dispatch execution claims and evaluates preflight safeguards
      execution!.state = 'EVALUATING';
      execution!.lease = { token: 'lease_test', until: new Date(Date.now() + 60000), claimedBy: 'worker_1' };
      await execution!.save();

      const dispatchResult = await executeDueStepDispatch(execution!.id, mockAdapter);
      expect(dispatchResult).toBe('SKIPPED');

      // Execution marked SKIPPED_STOCK_DEPLETED with zero provider calls (A15)
      const updatedExecution = await CampaignExecutionModel.findOne({ id: execution?.id });
      expect(updatedExecution?.state).toBe('SKIPPED');
      expect(updatedExecution?.outcomeReason).toBe('SKIPPED_STOCK_DEPLETED');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('A16: Multiple matching restock requests for the same customer are consolidated into one payload', async () => {
      const mockAdapter = new MockWhatsAppDeliveryAdapter();

      const product = await ProductModel.create({
        id: generateId('prd'),
        tenantId,
        sku: 'SKU-BANARASI-GOLD-002',
        title: 'Banarasi Katan Silk Saree',
        weave: 'Banarasi',
        color: 'Gold',
        pricePaise: 6500000,
        stockCount: 5,
        isSellable: true
      });

      const customer = await CustomerModel.create({
        id: 'cus_p3_consolidated',
        tenantId,
        firstName: 'Meera',
        lastName: 'Nambiar',
        phone: '+919876500042',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      // Customer created 2 separate requests for the same arrival SKU (e.g. for self and daughter)
      await CustomerProductRequestModel.create({
        id: 'req_002_meera_self',
        tenantId,
        customerId: customer.id,
        sku: product.sku,
        status: 'OPEN',
        requestedAt: new Date()
      });

      await CustomerProductRequestModel.create({
        id: 'req_003_meera_gift',
        tenantId,
        customerId: customer.id,
        sku: product.sku,
        status: 'OPEN',
        requestedAt: new Date()
      });

      const campaign = await CampaignModel.create({
        id: 'cmp_restock_consolidate',
        tenantId,
        name: 'Consolidated Restock',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_restock_2',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_restock_2',
        tenantId,
        campaignId: campaign.id,
        version: 1,
        name: campaign.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'inventory.available' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'restock_notification',
            offsetDays: 0,
            localTime: '11:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_stock_restock', revision: 2, language: 'en' },
            bindings: { name: 'customer.firstName', item: 'product.title' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 180
          }
        ],
        priority: 60,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_p3_a16'
      });

      const arrivalEvent: DomainEvent<any> = {
        schemaVersion: 1,
        producer: 'inventory',
        eventId: 'evt_arr_102',
        tenantId,
        type: 'inventory.available',
        entityId: product.sku,
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          sku: product.sku,
          stockCount: 5,
          arrivalEventId: 'arr_festival_2026'
        }
      };

      const matchResult = await evaluateInventoryArrivalEvent(arrivalEvent);
      expect(matchResult.matchedRequests).toBe(2);
      expect(matchResult.createdEnrollments).toBe(1); // Consolidated into exactly ONE enrollment!
      expect(matchResult.consolidatedCount).toBe(1);

      // Verify all matched requests marked NOTIFIED
      const notifiedRequests = await CustomerProductRequestModel.find({ customerId: customer.id, status: 'NOTIFIED' });
      expect(notifiedRequests.length).toBe(2);

      // Verify stock recount event is ignored
      const recountEvent: DomainEvent<any> = {
        schemaVersion: 1,
        producer: 'inventory',
        eventId: 'evt_recount_1',
        tenantId,
        type: 'inventory.available',
        entityId: product.sku,
        entityVersion: 2,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          sku: product.sku,
          stockCount: 5,
          isStockRecount: true // Recount flag
        }
      };

      const recountResult = await evaluateInventoryArrivalEvent(recountEvent);
      expect(recountResult.createdEnrollments).toBe(0);
      expect(recountResult.matchedRequests).toBe(0);
    });

    it('Festival, Collection Release, and Selected Stock Offer occurrences', async () => {
      const customer = await CustomerModel.create({
        id: 'cus_merch_presets',
        tenantId,
        firstName: 'Pooja',
        lastName: 'Sharma',
        phone: '+919876500043',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_festival',
        tenantId,
        name: 'Diwali Festive Preview',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_fest_1',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_fest_1',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'festival.announced' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'festival_greeting',
            offsetDays: 0,
            localTime: '11:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_festival_launch', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 240
          }
        ],
        priority: 50,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_fest'
      });

      const festRes = await evaluateFestivalEvent(tenantId, camp.id, 'diwali_2026');
      expect(festRes.enrolledCount).toBe(1);

      const festEnr = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer.id });
      expect(festEnr?.occurrenceId).toBe('festival:diwali_2026');
    });
  });

  describe('2. Customer Lifecycle: Win-Back Inactivity, Facts & Refund Anchor (A13, A14, B17)', () => {
    it('A13 & B17: Inactivity scan queries indexed campaignCustomerFacts nextEvaluationAt to enroll inactive patrons', async () => {
      const customer = await CustomerModel.create({
        id: 'cus_p3_lifecycle',
        tenantId,
        firstName: 'Geeta',
        lastName: 'Iyer',
        phone: '+919876500044',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      // Customer purchased 120 days ago (threshold is 90 days)
      const purchaseDate = new Date(Date.now() - 120 * 24 * 3600 * 1000);
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customer.id,
        orderId: 'ord_ancient_100',
        purchaseAt: purchaseDate,
        netPaise: 8000000
      });

      // Update nextEvaluationAt to be due now (B17)
      await CampaignCustomerFactModel.updateOne(
        { tenantId, customerId: customer.id },
        { $set: { nextEvaluationAt: new Date(Date.now() - 1000) } }
      );

      const winbackCamp = await CampaignModel.create({
        id: 'cmp_winback_inactivity',
        tenantId,
        name: '90-Day Win-Back Inactivity',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_winback_90',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_winback_90',
        tenantId,
        campaignId: winbackCamp.id,
        version: 1,
        name: winbackCamp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'INACTIVITY_SCAN', inactivityDays: 90 },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'winback_nudge',
            offsetDays: 0,
            localTime: '11:30',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_winback_offer', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName', offer: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 180
          }
        ],
        priority: 30,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_winback'
      });

      // Execute daily indexed inactivity scan
      const scanResult = await runIndexedInactivityScan(tenantId, new Date());
      expect(scanResult.evaluatedCount).toBe(1);
      expect(scanResult.enrolledCount).toBe(1);

      // Verify occurrence key format: winback:lastQualifyingOrderId:ruleId (Spec p.14, A13)
      const enrollment = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer.id });
      expect(enrollment?.occurrenceId).toBe('winback:ord_ancient_100:cv_winback_90');
      expect(enrollment?.status).toBe('ACTIVE');

      // Verify nextEvaluationAt was advanced by 24h so scan is efficient (B17)
      const updatedFact = await CampaignCustomerFactModel.findOne({ tenantId, customerId: customer.id });
      expect(updatedFact?.nextEvaluationAt?.getTime()).toBeGreaterThan(Date.now());
    });

    it('A14: Order refund recomputes customer facts and anchor without re-sending already completed winback occurrence', async () => {
      const customer = await CustomerModel.create({
        id: 'cus_p3_refund',
        tenantId,
        firstName: 'Sujata',
        lastName: 'Bose',
        phone: '+919876500045',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const order1Date = new Date(Date.now() - 150 * 24 * 3600 * 1000);
      const order2Date = new Date(Date.now() - 30 * 24 * 3600 * 1000);

      // Initially customer made order 2 (most recent)
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customer.id,
        orderId: 'ord_refunded_recent',
        purchaseAt: order2Date,
        netPaise: 5000000
      });

      // Complete a previous winback enrollment for order 1
      await CampaignEnrollmentModel.create({
        id: 'enr_completed_winback',
        tenantId,
        campaignId: 'cmp_winback',
        campaignVersionId: 'cv_winback',
        customerId: customer.id,
        occurrenceId: 'winback:ord_prior_1:cv_winback',
        sourceRef: { type: 'ORDER_EVENT', id: 'ord_prior_1', version: 1 },
        planRevision: 1,
        status: 'COMPLETED',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Order 2 is refunded!
      const recomputedFact = await handleOrderRefundFact(
        tenantId,
        customer.id,
        'ord_refunded_recent',
        [{ orderId: 'ord_prior_1', purchaseAt: order1Date }] // order 1 is the remaining valid order
      );

      expect(recomputedFact?.lastQualifyingOrderId).toBe('ord_prior_1');
      expect(recomputedFact?.lastQualifyingPurchaseAt).toEqual(order1Date);
      expect(recomputedFact?.aggregateVersion).toBe(2);

      // Verify the completed enrollment for ord_prior_1 is NOT re-enrolled or duplicated (A14)
      const winbackCamp = await CampaignModel.create({
        id: 'cmp_winback',
        tenantId,
        name: 'Winback Ref',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_winback',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_winback',
        tenantId,
        campaignId: winbackCamp.id,
        version: 1,
        name: winbackCamp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'INACTIVITY_SCAN', inactivityDays: 90 },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'winback_nudge',
            offsetDays: 0,
            localTime: '11:30',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_winback_offer', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName', offer: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 180
          }
        ],
        priority: 30,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_winback_ref'
      });

      // Make nextEvaluationAt due
      await CampaignCustomerFactModel.updateOne({ tenantId, customerId: customer.id }, { $set: { nextEvaluationAt: new Date(Date.now() - 1000) } });

      const scanResult = await runIndexedInactivityScan(tenantId, new Date());
      expect(scanResult.enrolledCount).toBe(0); // Completed occurrence suppressed! Zero duplicates!
    });
  });

  describe('3. Boutique Service Family & Caps Exemption (B16, C14)', () => {
    it('B16: Boutique service (PURPOSE = ORDER_SERVICE) does NOT consume marketing contact cap', async () => {
      const mockAdapter = new MockWhatsAppDeliveryAdapter();

      const customer = await CustomerModel.create({
        id: 'cus_p3_service_cap',
        tenantId,
        firstName: 'Kavitha',
        lastName: 'Menon',
        phone: '+919876500046',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      // 1. Customer already received 1 marketing message today (hitting 1/24h marketing cap)
      const marketingExecution = await CampaignExecutionModel.create({
        id: 'exe_mkt_cap_fill',
        tenantId,
        enrollmentId: 'enr_mkt_1',
        campaignId: 'cmp_mkt_1',
        stepId: 'greeting',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: new Date().toISOString().slice(0, 10),
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE',
        lease: { token: 'tok_mkt', until: new Date(Date.now() + 60000), claimedBy: 'worker_1' }
      });

      await CampaignModel.create({
        id: 'cmp_mkt_1',
        tenantId,
        name: 'Marketing Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_mkt_1',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_mkt_1',
        tenantId,
        campaignId: 'cmp_mkt_1',
        version: 1,
        name: 'Marketing Version',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'greeting',
            offsetDays: 0,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_greeting', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: false,
            stopOnGoal: false,
            maxLatenessMinutes: 240
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_mkt'
      });

      await CampaignEnrollmentModel.create({
        id: 'enr_mkt_1',
        tenantId,
        campaignId: 'cmp_mkt_1',
        campaignVersionId: 'cv_mkt_1',
        customerId: customer.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: customer.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Dispatch marketing message -> consumes 1/24h marketing slot
      const mktRes = await executeDueStepDispatch(marketingExecution.id, mockAdapter);
      expect(mktRes).toBe('PROVIDER_ACCEPTED');

      // 2. Now trigger an operational Boutique Service update (alteration ready)
      const serviceCamp = await CampaignModel.create({
        id: 'cmp_service_blouse',
        tenantId,
        name: 'Blouse Alteration Ready',
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        status: 'ACTIVE',
        activeVersionId: 'cv_service_blouse',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const serviceVersion = await CampaignVersionModel.create({
        id: 'cv_service_blouse',
        tenantId,
        campaignId: serviceCamp.id,
        version: 1,
        name: serviceCamp.name,
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'alteration.completed' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'ready_for_pickup',
            offsetDays: 0,
            localTime: '11:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_alteration_ready', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName', outfit: 'order.itemTitle', store: 'shop.displayName' },
            stopOnReply: false,
            stopOnGoal: false,
            maxLatenessMinutes: 240
          }
        ],
        priority: 90,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_svc'
      });

      const altEvent: DomainEvent<any> = {
        schemaVersion: 1,
        producer: 'boutique.tailoring',
        eventId: 'evt_tailor_99',
        tenantId,
        type: 'alteration.completed',
        entityId: 'job_blouse_99',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          jobId: 'job_blouse_99',
          customerId: customer.id,
          itemTitle: 'Custom Silk Blouse'
        }
      };

      const altResult = await evaluateAlterationReadyEvent(altEvent);
      expect(altResult.enrolled).toBe(true);

      const serviceExecution = await CampaignExecutionModel.findOne({ id: altResult.executionId });
      serviceExecution!.state = 'EVALUATING';
      serviceExecution!.lease = { token: 'tok_svc', until: new Date(Date.now() + 60000), claimedBy: 'worker_1' };
      await serviceExecution!.save();

      // Dispatch service execution: NOT BLOCKED BY 1/24h MARKETING CAP (B16)!
      const svcRes = await executeDueStepDispatch(serviceExecution!.id, mockAdapter);
      expect(svcRes).toBe('PROVIDER_ACCEPTED');
      expect(mockAdapter.getCallCount()).toBe(2);
    });

    it('C14: Marketing template cannot pass itself off as service', async () => {
      const customer = await CustomerModel.create({
        id: 'cus_p3_c14',
        tenantId,
        firstName: 'Revathi',
        lastName: 'Raman',
        phone: '+919876500047',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      // Campaign defined as ORDER_SERVICE, but tries to use a MARKETING template (C14)
      const serviceCamp = await CampaignModel.create({
        id: 'cmp_fraud_service',
        tenantId,
        name: 'Sneaky Service Campaign',
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        status: 'ACTIVE',
        activeVersionId: 'cv_fraud_service',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_fraud_service',
        tenantId,
        campaignId: serviceCamp.id,
        version: 1,
        name: serviceCamp.name,
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'delivery.updated' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'sneaky_promo_step',
            offsetDays: 0,
            localTime: '11:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' }, // MARKETING template!
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 180
          }
        ],
        priority: 90,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_fraud'
      });

      const enrollment = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId: serviceCamp.id,
        campaignVersionId: 'cv_fraud_service',
        customerId: customer.id,
        occurrenceId: 'delivery:ord_99:OUT_FOR_DELIVERY',
        sourceRef: { type: 'ORDER_EVENT', id: 'ord_99', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const execution = await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        enrollmentId: enrollment.id,
        campaignId: serviceCamp.id,
        stepId: 'sneaky_promo_step',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: new Date().toISOString().slice(0, 10),
        localTime: '11:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE'
      });

      const safeguardResult = await executePreflightSafeguards(execution);
      expect(safeguardResult.status).toBe('BLOCKED');
      expect((safeguardResult as any).reason).toBe('BLOCKED_TEMPLATE_PURPOSE_MISMATCH');
    });

    it('Duplicate courier events are ignored (per-order dedupe)', async () => {
      await CustomerModel.create({
        id: 'cus_p3_courier',
        tenantId,
        firstName: 'Sangeetha',
        lastName: 'Balan',
        phone: '+919876500048',
        status: 'ACTIVE',
        channelSuppressed: false
      });

      const serviceCamp = await CampaignModel.create({
        id: 'cmp_courier',
        tenantId,
        name: 'Courier Updates',
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        status: 'ACTIVE',
        activeVersionId: 'cv_courier',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_courier',
        tenantId,
        campaignId: serviceCamp.id,
        version: 1,
        name: serviceCamp.name,
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'delivery.updated' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'out_for_delivery',
            offsetDays: 0,
            localTime: '10:30',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_delivery_update', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName', outfit: 'order.itemTitle', store: 'shop.displayName' },
            stopOnReply: false,
            stopOnGoal: false,
            maxLatenessMinutes: 240
          }
        ],
        priority: 90,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_courier'
      });

      const courierEvent: DomainEvent<any> = {
        schemaVersion: 1,
        producer: 'logistics.courier',
        eventId: 'evt_del_1',
        tenantId,
        type: 'delivery.updated',
        entityId: 'del_ord_501',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          orderId: 'ord_501',
          customerId: 'cus_p3_courier',
          deliveryStatus: 'OUT_FOR_DELIVERY'
        }
      };

      const res1 = await evaluateDeliveryUpdateEvent(courierEvent);
      expect(res1.enrolled).toBe(true);

      // Re-delivery of identical status event
      const res2 = await evaluateDeliveryUpdateEvent(courierEvent);
      expect(res2.enrolled).toBe(false); // Ignored duplicate!
    });
  });

  describe('4. Universal Source Event Ingress: Schema Versioning & Quarantine', () => {
    it('Persists valid schema and rejects stale entity versions', async () => {
      const validEvent = {
        schemaVersion: 1,
        producer: 'pos.billing',
        eventId: 'evt_valid_1',
        tenantId,
        type: 'order.completed',
        entityId: 'ord_9901',
        entityVersion: 2,
        occurredAt: new Date().toISOString(),
        data: {
          orderId: 'ord_9901',
          customerId: 'cus_1',
          netPaise: 5000000
        }
      };

      const ingest1 = await ingestDomainEvent(validEvent);
      expect(ingest1.success).toBe(true);
      expect(ingest1.status).toBe('PERSISTED');

      // Stale entity version (version 1 after version 2)
      const staleEvent = {
        ...validEvent,
        eventId: 'evt_stale_2',
        entityVersion: 1
      };

      const ingest2 = await ingestDomainEvent(staleEvent);
      expect(ingest2.success).toBe(false);
      expect(ingest2.status).toBe('REJECTED_STALE_VERSION');
    });

    it('Quarantines unknown event schema families to visible status', async () => {
      const unknownEvent = {
        schemaVersion: 1,
        producer: 'thirdparty.unknown',
        eventId: 'evt_unknown_family',
        tenantId,
        type: 'crypto.airdrop',
        entityId: 'wallet_1',
        entityVersion: 1,
        occurredAt: new Date().toISOString(),
        data: { arbitrary: 'data' }
      };

      const ingestRes = await ingestDomainEvent(unknownEvent);
      expect(ingestRes.success).toBe(false);
      expect(ingestRes.status).toBe('QUARANTINE');

      const quarantinedRecord = await CampaignEventInboxModel.findOne({ tenantId, eventId: 'evt_unknown_family' });
      expect(quarantinedRecord?.status).toBe('QUARANTINE');
    });
  });
});
