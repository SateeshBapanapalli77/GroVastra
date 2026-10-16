import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import crypto from 'crypto';
import app from '../src/server';
import { generateId } from '../src/shared/utils/id';
import { signJwt } from '../src/shared/middleware/auth.middleware';
import { signInternalServiceToken } from '../src/shared/middleware/internalAuth.middleware';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CampaignDryRunModel } from '../src/modules/campaigns/models/CampaignDryRun.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { TenantSettingsModel } from '../src/modules/campaigns/models/TenantSettings.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { runDispatchCycle } from '../src/modules/campaigns/engine/dispatchExecutor';
import { evaluateCampaignDryRun } from '../src/modules/campaigns/engine/dryRun';

describe('Step 13: End-to-End Vertical Slice Verification', () => {
  const tenantId = 'qa_tenant_e2e_slice';
  const connectionId = 'conn_e2e_slice';
  const phoneNumberId = 'phone_e2e_slice';
  const patronPhone = '+919876543210';
  const webhookSecret = process.env.WHATSAPP_APP_SECRET || 'dev_secret_meta_webhook';

  let server: http.Server;
  let baseUrl: string;
  let ownerToken: string;
  let ordersServiceToken: string;

  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI must be provided by test harness');
    }

    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

    ownerToken = signJwt({
      userId: 'usr_owner_slice',
      tenantId,
      role: 'BOUTIQUE_OWNER'
    });

    ordersServiceToken = signInternalServiceToken({
      tenantId,
      producer: 'orders_service',
      eventFamily: 'orders'
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(async () => {
    await Promise.all([
      CampaignModel.deleteMany({ tenantId }),
      CampaignVersionModel.deleteMany({ tenantId }),
      CampaignEnrollmentModel.deleteMany({ tenantId }),
      CampaignExecutionModel.deleteMany({ tenantId }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId }),
      CampaignDryRunModel.deleteMany({ tenantId }),
      TenantConnectionModel.deleteMany({ tenantId }),
      TenantSettingsModel.deleteMany({ tenantId }),
      CustomerModel.deleteMany({ tenantId })
    ]);

    // 1. Setup Tenant Settings
    await TenantSettingsModel.create({
      id: generateId('set'),
      tenantId,
      storeName: 'Kanjeevaram Silks Heritage',
      timezone: 'Asia/Kolkata',
      allowedHours: { start: '08:00', end: '21:00' },
      caps: { marketing24h: 1, marketing7d: 3 },
      globalPause: false,
      outageGraceMinutes: 120,
      leapDayPolicy: 'FEB_28',
      holidays: [],
      blackouts: [],
      notice: 'Active tenant marketing policy notice',
      version: 1
    });

    // 2. Setup Active WhatsApp Connection
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId,
      connectionId,
      wabaId: 'waba_e2e_slice',
      phoneNumberId,
      displayPhoneNumber: '+919876500000',
      verifiedName: 'Kanjeevaram Silks',
      status: 'ACTIVE',
      active: true,
      metadata: { phoneNumberId }
    });
  });

  it('executes full vertical slice: activation -> planning -> step 1 send -> delivered webhook -> customer reply hold -> goal order -> step 2 skip -> enrollment completion', async () => {
    const mockAdapter = new MockWhatsAppDeliveryAdapter();
    const now = new Date();
    // Birthday set to tomorrow so steps are cleanly planned in the future
    const targetBirthday = new Date(now.getTime() + 24 * 3600 * 1000);
    const currentMonth = targetBirthday.getMonth() + 1;
    const currentDay = targetBirthday.getDate();

    // -------------------------------------------------------------
    // STAGE 0: Setup Patron in CRM (Birthday upcoming tomorrow)
    // -------------------------------------------------------------
    const customer = await CustomerModel.create({
      id: generateId('cus'),
      tenantId,
      firstName: 'Ananya',
      lastName: 'Sharma',
      phone: patronPhone,
      birthdayMonth: currentMonth,
      birthdayDay: currentDay,
      totalSpendPaise: 4500000,
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false
    });

    // -------------------------------------------------------------
    // STAGE 1: Create Birthday Campaign Draft & Dry Run
    // -------------------------------------------------------------
    const campaignId = generateId('cmp');
    const versionId = generateId('cv');

    const campaign = await CampaignModel.create({
      id: campaignId,
      tenantId,
      presetId: 'preset_birthday_shopping',
      name: 'Annual Patron Birthday Privilege',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'DRAFT',
      draftVersion: 1,
      activeVersionId: null,
      pauseGeneration: 0
    });

    const draftVersion = await CampaignVersionModel.create({
      id: versionId,
      tenantId,
      campaignId: campaign.id,
      presetId: 'preset_birthday_shopping',
      version: 1,
      name: campaign.name,
      brandName: 'Kanjeevaram Silks Heritage',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: {
        type: 'ANNUAL_DATE',
        field: 'customer.birthday',
        leapDayPolicy: 'FEB_28'
      },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'birthday_invitation',
          offsetDays: 0, // Due today (D0)
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
          stopOnReply: true,
          stopOnGoal: true,
          maxLatenessMinutes: 240
        },
        {
          stepId: 'birthday_followup',
          offsetDays: 3, // Due in 3 days (D+3)
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_followup', revision: 1, language: 'en' },
          bindings: { name: 'customer.firstName' },
          stopOnReply: true,
          stopOnGoal: true,
          maxLatenessMinutes: 240
        }
      ],
      priority: 80,
      publishedBy: 'owner',
      reviewFingerprint: 'fp_initial_e2e'
    });

    // Run Dry-Run to compute review fingerprint
    const dryRunResult = await evaluateCampaignDryRun(draftVersion);
    draftVersion.reviewFingerprint = dryRunResult.draftFingerprint;
    await draftVersion.save();

    await CampaignDryRunModel.create({
      id: generateId('dry'),
      tenantId,
      campaignId: campaign.id,
      draftVersion: 1,
      draftFingerprint: dryRunResult.draftFingerprint,
      summary: dryRunResult.summary,
      reasonBreakdown: dryRunResult.reasonBreakdown,
      samplePlans: []
    });

    // Assert stage 1 pre-activation state
    expect(mockAdapter.getCallCount()).toBe(0);

    // -------------------------------------------------------------
    // STAGE 2: Activate Campaign via API -> Planner Enrolls Patron
    // -------------------------------------------------------------
    const activateRes = await fetch(`${baseUrl}/campaigns/${campaign.id}/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'Idempotency-Key': generateId('idemp_act')
      },
      body: JSON.stringify({
        expectedVersion: 1,
        reviewFingerprint: dryRunResult.draftFingerprint
      })
    });

    const activateData = await activateRes.json();
    if (activateRes.status !== 200) {
      console.log('ACTIVATE ERROR:', activateData);
    }
    expect(activateRes.status).toBe(200);
    expect(activateData.success).toBe(true);

    // DB Assertions: Campaign is now ACTIVE with activeVersionId
    const activatedCampaign = await CampaignModel.findOne({ id: campaign.id, tenantId });
    expect(activatedCampaign?.status).toBe('ACTIVE');
    expect(activatedCampaign?.activeVersionId).toBe(draftVersion.id);

    // DB Assertions: Planner enrolled patron for this birthday occurrence
    const enrollment = await CampaignEnrollmentModel.findOne({
      tenantId,
      customerId: customer.id,
      campaignId: campaign.id
    });
    expect(enrollment).not.toBeNull();
    expect(enrollment?.status).toBe('ACTIVE');
    expect(enrollment?.replyHoldAt).toBeNull();
    expect(enrollment?.goalReachedAt).toBeNull();
    expect(enrollment?.occurrenceId).toBe(`birthday:${now.getFullYear()}`);

    // DB Assertions: Planner scheduled 2 execution steps
    const executions = await CampaignExecutionModel.find({
      tenantId,
      enrollmentId: enrollment!.id
    }).sort({ stepId: 1 });

    expect(executions.length).toBe(2);

    const step1Invite = executions.find((e) => e.stepId === 'birthday_invitation');
    const step2Followup = executions.find((e) => e.stepId === 'birthday_followup');

    expect(step1Invite).toBeDefined();
    expect(step1Invite?.state).toBe('SCHEDULED');
    expect(step2Followup).toBeDefined();
    expect(step2Followup?.state).toBe('SCHEDULED');

    // Provider adapter call count is strictly 0 at activation/planning
    expect(mockAdapter.getCallCount()).toBe(0);

    // -------------------------------------------------------------
    // STAGE 3: Executor Worker Dispatches Step 1 (Due Today)
    // -------------------------------------------------------------
    // Run fair dispatch cycle for tenant at step 1 due time
    const dispatchStats = await runDispatchCycle(tenantId, 5, mockAdapter, step1Invite!.dueAt);
    expect(dispatchStats.claimedCount).toBe(1);
    expect(dispatchStats.acceptedCount).toBe(1);

    // Provider adapter call count is exactly 1
    expect(mockAdapter.getCallCount()).toBe(1);
    expect(mockAdapter.submissions.length).toBe(1);

    const submission = mockAdapter.submissions[0];
    expect(submission.template.id).toBe('tpl_birthday_invite');
    expect(submission.recipientPhone).toBe(patronPhone);
    expect(submission.parameters.name).toBe('Ananya');
    expect(submission.parameters.shop).toBe('Kanjeevaram Silks Heritage');

    // DB Assertions: Step 1 transitioned to PROVIDER_ACCEPTED with deliveryIntentId
    const refreshedStep1 = await CampaignExecutionModel.findOne({ id: step1Invite!.id });
    expect(refreshedStep1?.state).toBe('PROVIDER_ACCEPTED');
    expect(refreshedStep1?.deliveryIntentId).toBeTruthy();

    // DB Assertions: Delivery intent frozen with encrypted recipient phone and canonical payload hash
    const intent = await CampaignDeliveryIntentModel.findOne({
      tenantId,
      id: refreshedStep1!.deliveryIntentId
    });
    expect(intent).not.toBeNull();
    expect(intent?.state).toBe('ACCEPTED');
    expect(intent?.providerMessageId).toBeTruthy();
    expect(intent?.encryptedRecipient).toBeTruthy();
    expect(intent?.encryptedRecipient).not.toBe(patronPhone); // Must be encrypted at rest

    const providerMessageId = intent!.providerMessageId!;

    // DB Assertions: Step 2 remains SCHEDULED (not due yet)
    const refreshedStep2Before = await CampaignExecutionModel.findOne({ id: step2Followup!.id });
    expect(refreshedStep2Before?.state).toBe('SCHEDULED');

    // -------------------------------------------------------------
    // STAGE 4: Webhook Delivered Receipt Arrives from WhatsApp
    // -------------------------------------------------------------
    const deliveredPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry_wh_delivered',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  phone_number_id: phoneNumberId,
                  display_phone_number: '+919876500000'
                },
                statuses: [
                  {
                    id: providerMessageId,
                    status: 'delivered',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: '919876543210'
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    const rawDelivered = JSON.stringify(deliveredPayload);
    const deliveredSig = `sha256=${crypto.createHmac('sha256', webhookSecret).update(rawDelivered).digest('hex')}`;

    const deliveredRes = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': deliveredSig
      },
      body: rawDelivered
    });

    expect(deliveredRes.status).toBe(200);

    // DB Assertions: Step 1 execution transitioned to DELIVERED
    const deliveredStep1 = await CampaignExecutionModel.findOne({ id: step1Invite!.id });
    expect(deliveredStep1?.state).toBe('DELIVERED');
    expect(deliveredStep1?.deliveredAt).not.toBeNull();

    // DB Assertions: Delivery intent updated with deliveredAt
    const deliveredIntent = await CampaignDeliveryIntentModel.findOne({ tenantId, providerMessageId });
    expect(deliveredIntent?.deliveredAt).not.toBeNull();

    // Adapter call count remains 1 (no re-send)
    expect(mockAdapter.getCallCount()).toBe(1);

    // -------------------------------------------------------------
    // STAGE 5: Inbound Customer Reply Arrives -> Activates Reply Hold
    // -------------------------------------------------------------
    const replyPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry_wh_reply',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  phone_number_id: phoneNumberId,
                  display_phone_number: '+919876500000'
                },
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.inbound_ananya_reply',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: {
                      body: 'Thank you for the warm birthday wishes! I will visit the store this weekend to view the bridal silks.'
                    },
                    type: 'text'
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    const rawReply = JSON.stringify(replyPayload);
    const replySig = `sha256=${crypto.createHmac('sha256', webhookSecret).update(rawReply).digest('hex')}`;

    const replyRes = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': replySig
      },
      body: rawReply
    });

    expect(replyRes.status).toBe(200);

    // DB Assertions: Enrollment replyHoldAt is now set
    const heldEnrollment = await CampaignEnrollmentModel.findOne({ id: enrollment!.id });
    expect(heldEnrollment?.replyHoldAt).not.toBeNull();
    expect(heldEnrollment?.status).toBe('ACTIVE');

    // DB Assertions: Step 1 remains DELIVERED; Step 2 remains SCHEDULED
    const heldStep1 = await CampaignExecutionModel.findOne({ id: step1Invite!.id });
    expect(heldStep1?.state).toBe('DELIVERED');
    const heldStep2 = await CampaignExecutionModel.findOne({ id: step2Followup!.id });
    expect(heldStep2?.state).toBe('SCHEDULED');

    // Adapter call count remains 1
    expect(mockAdapter.getCallCount()).toBe(1);

    // -------------------------------------------------------------
    // STAGE 6 & 7: Goal Purchase Recorded via Orders Webhook
    // -> Step 2 Skipped with SKIPPED_GOAL_REACHED
    // -------------------------------------------------------------
    const orderGoalPayload = {
      orderId: 'ord_slice_birthday_purchase_99',
      customerId: customer.id,
      occasionRef: `birthday:${now.getFullYear()}`,
      netPaise: 6500000
    };

    const orderRes = await fetch(`${baseUrl}/webhooks/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ordersServiceToken}`,
        'x-internal-api-key': ordersServiceToken
      },
      body: JSON.stringify(orderGoalPayload)
    });

    expect(orderRes.status).toBe(200);
    const orderData = await orderRes.json();
    expect(orderData.success).toBe(true);
    expect(orderData.updatedEnrollments).toBe(1);

    // DB Assertions: Enrollment marked with goal timestamp and order ref
    const goalEnrollment = await CampaignEnrollmentModel.findOne({ id: enrollment!.id });
    expect(goalEnrollment?.goalReachedAt).not.toBeNull();
    expect(goalEnrollment?.goalOrderRef).toBe('ord_slice_birthday_purchase_99');
    expect(goalEnrollment?.goalNetPaise).toBe(6500000);

    // DB Assertions: Step 2 was skipped with SKIPPED_GOAL_REACHED
    const finalStep2 = await CampaignExecutionModel.findOne({ id: step2Followup!.id });
    expect(finalStep2?.state).toBe('SKIPPED');
    expect(finalStep2?.outcomeReason).toBe('SKIPPED_GOAL_REACHED');

    // Adapter call count is STILL 1 (Step 2 was NEVER dispatched to provider!)
    expect(mockAdapter.getCallCount()).toBe(1);

    // -------------------------------------------------------------
    // STAGE 8: Enrollment Completes
    // -------------------------------------------------------------
    // DB Assertions: No pending executions remain, enrollment status is COMPLETED
    const pendingExecutions = await CampaignExecutionModel.countDocuments({
      tenantId,
      enrollmentId: enrollment!.id,
      state: { $in: ['SCHEDULED', 'DEFERRED', 'EVALUATING', 'DISPATCHING', 'RETRY_WAIT'] }
    });
    expect(pendingExecutions).toBe(0);

    const completedEnrollment = await CampaignEnrollmentModel.findOne({ id: enrollment!.id });
    expect(completedEnrollment?.status).toBe('COMPLETED');

    // Final adapter invariant check: only 1 total message was dispatched across entire lifecycle
    expect(mockAdapter.getCallCount()).toBe(1);
  });
});
