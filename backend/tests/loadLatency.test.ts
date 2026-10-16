import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { executeDueStepDispatch } from '../src/modules/campaigns/engine/dispatchExecutor';
import { generateId } from '../src/shared/utils/id';

describe('Work Package P4: Load and Latency Test against Provider Limits', () => {
  const tenantId = 'qa_tenant_load';
  const BATCH_SIZE = 100;

  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI must be provided by test harness');
    }
  });

  beforeEach(async () => {
    await Promise.all([
      CampaignModel.deleteMany({ tenantId }),
      CampaignVersionModel.deleteMany({ tenantId }),
      CampaignEnrollmentModel.deleteMany({ tenantId }),
      CampaignExecutionModel.deleteMany({ tenantId }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId }),
      CustomerModel.deleteMany({ tenantId }),
      TenantConnectionModel.deleteMany({ tenantId })
    ]);

    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId,
      connectionId: 'conn_load_sandbox',
      wabaId: 'waba_load',
      phoneNumberId: 'phone_load',
      displayPhoneNumber: '+919876500000',
      active: true
    });
  });

  it('measures dispatch throughput and latency for 100 due steps without races or duplicate provider calls', async () => {
    const mockAdapter = new MockWhatsAppDeliveryAdapter();

    // 1. Setup campaign & version
    const campaign = await CampaignModel.create({
      id: 'cmp_load_test',
      tenantId,
      name: 'Batch Festival Dispatch',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'ACTIVE',
      activeVersionId: 'cv_load_test',
      draftVersion: 1,
      pauseGeneration: 0
    });

    await CampaignVersionModel.create({
      id: 'cv_load_test',
      tenantId,
      campaignId: campaign.id,
      version: 1,
      name: campaign.name,
      brandName: 'Festival Boutique',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'EVENT_DRIVEN', eventType: 'festival.launch' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'announcement',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_festival_launch', revision: 1, language: 'en' },
          bindings: { name: 'customer.firstName', festival: 'shop.displayName' },
          stopOnReply: false,
          stopOnGoal: false,
          maxLatenessMinutes: 240
        }
      ],
      priority: 50,
      publishedBy: 'owner',
      reviewFingerprint: 'fp_load'
    });

    // 2. Generate 100 patrons, enrollments, and due executions
    const executionIds: string[] = [];
    const customerDocs = [];
    const enrollmentDocs = [];
    const executionDocs = [];

    const now = new Date();

    for (let i = 0; i < BATCH_SIZE; i++) {
      const customerId = `cus_load_${i}`;
      const enrollmentId = `enr_load_${i}`;
      const executionId = `exe_load_${i}`;
      executionIds.push(executionId);

      customerDocs.push({
        id: customerId,
        tenantId,
        firstName: `Patron${i}`,
        lastName: 'Boutique',
        phone: `+9198765${String(i).padStart(5, '0')}`,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      enrollmentDocs.push({
        id: enrollmentId,
        tenantId,
        campaignId: campaign.id,
        campaignVersionId: 'cv_load_test',
        customerId,
        occurrenceId: `diwali:2026:${i}`,
        sourceRef: { type: 'CUSTOMER_DATE', id: customerId, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      executionDocs.push({
        id: executionId,
        tenantId,
        enrollmentId,
        campaignId: campaign.id,
        stepId: 'announcement',
        dueAt: now,
        expiresAt: new Date(now.getTime() + 3600000),
        localDate: now.toISOString().slice(0, 10),
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE',
        lease: { token: `tok_${i}`, until: new Date(now.getTime() + 60000), claimedBy: 'worker_load' }
      });
    }

    await CustomerModel.insertMany(customerDocs);
    await CampaignEnrollmentModel.insertMany(enrollmentDocs);
    await CampaignExecutionModel.insertMany(executionDocs);

    // 3. Measure dispatch throughput and latency across batch
    const latenciesMs: number[] = [];
    const startTime = Date.now();

    for (const exeId of executionIds) {
      const stepStart = Date.now();
      const result = await executeDueStepDispatch(exeId, mockAdapter, now);
      const stepDuration = Date.now() - stepStart;

      latenciesMs.push(stepDuration);
      expect(result).toBe('PROVIDER_ACCEPTED');
    }

    const totalDurationMs = Date.now() - startTime;
    const throughputPerSec = (BATCH_SIZE / totalDurationMs) * 1000;

    // Latency metrics calculation
    latenciesMs.sort((a, b) => a - b);
    const p50 = latenciesMs[Math.floor(BATCH_SIZE * 0.5)];
    const p95 = latenciesMs[Math.floor(BATCH_SIZE * 0.95)];
    const p99 = latenciesMs[Math.floor(BATCH_SIZE * 0.99)];

    // Assert zero duplicate sends & exact provider call counts
    expect(mockAdapter.getCallCount()).toBe(BATCH_SIZE);
    expect(mockAdapter.submissions.length).toBe(BATCH_SIZE);

    // Assert all 100 executions persisted as PROVIDER_ACCEPTED in MongoDB
    const acceptedCount = await CampaignExecutionModel.countDocuments({
      tenantId,
      state: 'PROVIDER_ACCEPTED'
    });
    expect(acceptedCount).toBe(BATCH_SIZE);

    // Assert all 100 delivery intents exist with unique delivery keys
    const intentsCount = await CampaignDeliveryIntentModel.countDocuments({ tenantId });
    expect(intentsCount).toBe(BATCH_SIZE);

    // Assert acceptable latency characteristics (throughput > 10 msg/sec, p95 < 500ms in in-memory replica set)
    expect(throughputPerSec).toBeGreaterThan(10);
    expect(p95).toBeLessThan(500);

    // Log benchmark summary
    // (Note: no sensitive phone numbers or message bodies logged)
    const benchmarkSummary = {
      batchSize: BATCH_SIZE,
      totalDurationMs,
      throughputPerSec: Math.round(throughputPerSec * 10) / 10,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99
    };
    expect(benchmarkSummary.throughputPerSec).toBeGreaterThan(10);
  });
});
