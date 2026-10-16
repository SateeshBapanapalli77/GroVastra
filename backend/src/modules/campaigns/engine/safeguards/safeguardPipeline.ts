import { ICampaignExecution } from '../../models/CampaignExecution.model';
import { ICampaignEnrollment, CampaignEnrollmentModel } from '../../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../../models/CampaignExecution.model';
import { CampaignModel } from '../../models/Campaign.model';
import { CampaignVersionModel, ICampaignVersion } from '../../models/CampaignVersion.model';
import { CampaignDeliveryIntentModel } from '../../models/CampaignDeliveryIntent.model';
import { TenantControlGateModel } from '../../models/TenantControlGate.model';
import { CampaignControlGateModel } from '../../models/CampaignControlGate.model';
import { CustomerModel, ICustomer } from '../../../crm/models/Customer.model';
import { ProductModel } from '../../../inventory/models/Product.model';
import { getApprovedTemplate, resolveApprovedTemplate } from '../../adapters/templateCatalogue';
import { decryptText, sha256 } from '../../../../shared/utils/crypto';
import { normalizeE164 } from '../../../../shared/utils/phone';
import { adjustForAllowedHoursAndBlackouts } from '../../../../shared/utils/clock';
import { resolveShopDisplayName } from '../../services/shopResolver';
export { resolveShopDisplayName } from '../../services/shopResolver';
import { logger } from '../../../../config/logger';

export type PipelineOutcome =
  | { status: 'PROCEED'; customer: ICustomer; version: ICampaignVersion; enrollment: ICampaignEnrollment; campaign: any; parameters: Record<string, string>; payloadHash: string }
  | { status: 'SKIP'; reason: string }
  | { status: 'DEFER'; reason: string; nextDueAt: Date }
  | { status: 'BLOCKED'; reason: string };

/**
 * Preflight Safeguard Pipeline (Chain of Responsibility Pattern)
 * Evaluates gates in strict Reason Precedence Order (Handoff Page 33, DECISIONS.md):
 * 1. Customer Deleted / Channel Suppressed
 * 2. Campaign / Global Pause
 * 3. Invalid Source
 * 4. Expiry
 * 5. Goal / Reply Stop
 * 6. Content / Template Readiness
 * 7. Prerequisite
 * 8. Contact Cap (reserved during atomic submission transaction)
 */
export async function executePreflightSafeguards(
  execution: ICampaignExecution,
  serverNow: Date = new Date()
): Promise<PipelineOutcome> {
  const { tenantId, campaignId, enrollmentId, stepId, expiresAt } = execution;

  // Load prerequisites for evaluation
  const [tenantGate, campaign, campaignGate, enrollment] = await Promise.all([
    TenantControlGateModel.findOne({ tenantId }),
    CampaignModel.findOne({ id: campaignId, tenantId }),
    CampaignControlGateModel.findOne({ tenantId, campaignId }),
    CampaignEnrollmentModel.findOne({ id: enrollmentId, tenantId })
  ]);

  const version = enrollment
    ? await CampaignVersionModel.findOne({ id: enrollment.campaignVersionId, tenantId })
    : null;
  const customer = enrollment
    ? await CustomerModel.findOne({ id: enrollment.customerId, tenantId })
    : null;
  const stepDef = version?.steps.find((s) => s.stepId === stepId);

  // 1. Customer Deleted / Channel Suppressed / Marketing Opt-Out Gate (Handoff Page 33, DECISIONS.md)
  if (customer) {
    if (customer.status === 'DELETED' || (customer as any).deleted) {
      return { status: 'SKIP', reason: 'SKIPPED_CUSTOMER_DELETED' };
    }

    if (customer.channelSuppressed) {
      return { status: 'SKIP', reason: 'SKIPPED_CHANNEL_SUPPRESSED' };
    }

    if (version?.purpose === 'MARKETING' && !customer.optedInMarketing) {
      return { status: 'SKIP', reason: 'SKIPPED_MARKETING_OPT_OUT' };
    }
  } else if (enrollment) {
    // Enrollment exists but customer record was deleted from database
    return { status: 'SKIP', reason: 'SKIPPED_CUSTOMER_DELETED' };
  }

  // 2. Campaign / Global Pause Gate
  if (tenantGate?.globalPause) {
    return { status: 'SKIP', reason: 'CAMPAIGN_OR_GLOBAL_PAUSED' };
  }

  if (campaign && (campaign.status === 'PAUSED' || campaign.status === 'ARCHIVED' || campaignGate?.paused)) {
    return { status: 'SKIP', reason: 'SKIPPED_CAMPAIGN_PAUSED' };
  }

  const expectedPauseGen = campaignGate?.pauseGeneration ?? campaign?.pauseGeneration;
  if (
    typeof execution.pauseGeneration === 'number' &&
    expectedPauseGen !== undefined &&
    execution.pauseGeneration !== expectedPauseGen
  ) {
    return {
      status: 'DEFER',
      reason: 'DEFERRED_PAUSE_GENERATION_MISMATCH',
      nextDueAt: new Date(serverNow.getTime() + 60 * 1000)
    };
  }

  // 3. Invalid Source Gate
  if (!campaign) {
    return { status: 'SKIP', reason: 'SKIPPED_CAMPAIGN_NOT_FOUND' };
  }

  if (!enrollment || enrollment.status !== 'ACTIVE') {
    return { status: 'SKIP', reason: 'SKIPPED_ENROLLMENT_INACTIVE' };
  }

  if (!version) {
    return { status: 'SKIP', reason: 'SKIPPED_VERSION_NOT_FOUND' };
  }

  if (!stepDef) {
    return { status: 'SKIP', reason: 'SKIPPED_STEP_NOT_FOUND' };
  }

  if (!customer) {
    return { status: 'SKIP', reason: 'SKIPPED_CUSTOMER_DELETED' };
  }

  // Live Stock Re-check Gate (Spec p.13, tests A15, A16)
  if (enrollment.sourceRef?.type === 'STOCK_EVENT') {
    const sku = enrollment.sourceRef.id;
    const product = await ProductModel.findOne({ tenantId, sku });
    if (!product || product.stockCount <= 0 || !product.isSellable) {
      return { status: 'SKIP', reason: 'SKIPPED_STOCK_DEPLETED' };
    }
  }

  // 4. Expiry Check (Page 17 & 33)
  if (serverNow > expiresAt) {
    return { status: 'SKIP', reason: 'SKIPPED_STEP_EXPIRED' };
  }

  // 5. Goal / Reply Stop Rules (Handoff Page 8 & 11, Spec p.33)
  // Stop on Goal Purchase: takes precedence over reply hold
  if (stepDef.stopOnGoal !== false && enrollment.goalReachedAt !== null) {
    return { status: 'SKIP', reason: 'SKIPPED_GOAL_REACHED' };
  }

  // Stop on Customer Inbound Reply (Staff Hold)
  if (stepDef.stopOnReply && enrollment.replyHoldAt !== null) {
    return { status: 'SKIP', reason: 'SKIPPED_REPLY_HOLD' };
  }

  // 6. Content / Template Readiness Gate (Spec p.8, p.19, p.27, p.32 test C02, C19)
  let template;
  try {
    template = await resolveApprovedTemplate(
      stepDef.templateRef.id,
      tenantId,
      stepDef.templateRef.revision,
      stepDef.templateRef.language
    );
  } catch (tmplErr: any) {
    logger.error({ tmplErr: tmplErr?.message, executionId: execution.id }, 'Template resolution failed closed due to DB error');
    return { status: 'BLOCKED', reason: 'CONTENT_OR_TEMPLATE_BLOCKED' };
  }
  if (!template || template.status === 'PAUSED') {
    return { status: 'BLOCKED', reason: 'CONTENT_OR_TEMPLATE_BLOCKED' };
  }

  // Template Purpose Gate (Spec p.27, test C14)
  if (version.purpose === 'ORDER_SERVICE' && template.category === 'MARKETING') {
    return { status: 'BLOCKED', reason: 'BLOCKED_TEMPLATE_PURPOSE_MISMATCH' };
  }

  // Resolve Parameter Bindings (Spec p.8, p.19, C05)
  const storeDisplayName = await resolveShopDisplayName(tenantId, version);

  const { OrderModel } = await import('../../../orders/models/Order.model');
  let orderDoc: any = null;
  let boutiqueJobDoc: any = null;
  if (enrollment.sourceRef?.type === 'ORDER_EVENT') {
    orderDoc = await OrderModel.findOne({ tenantId, id: enrollment.sourceRef.id }).lean();
    const { BoutiqueJobModel } = await import('../../../crm/models/BoutiqueJob.model');
    boutiqueJobDoc = await BoutiqueJobModel.findOne({ tenantId, id: enrollment.sourceRef.id }).lean();
  }
  let productDoc: any = null;
  if (enrollment.sourceRef?.type === 'STOCK_EVENT') {
    productDoc = await ProductModel.findOne({ tenantId, sku: enrollment.sourceRef.id }).lean();
  }

  const parameters: Record<string, string> = {};
  const rawBindings = stepDef.bindings instanceof Map
    ? Object.fromEntries(stepDef.bindings.entries())
    : (stepDef.bindings || {});

  for (const varKey of template.variableKeys) {
    const rawExpr = rawBindings[varKey];
    let resolvedValue = '';
    let isCustomerOrInstanceVar = false;

    if (rawExpr) {
      const expr = typeof rawExpr === 'string' ? rawExpr : String(rawExpr || '');
      // Strict allowlist: ONLY customer name, shop, validated offer, event date, product, order
      if (expr === 'customer.firstName') {
        resolvedValue = customer.firstName || '';
        isCustomerOrInstanceVar = true;
      } else if (expr === 'customer.lastName') {
        resolvedValue = customer.lastName || '';
        isCustomerOrInstanceVar = true;
      } else if (expr === 'customer.fullName') {
        resolvedValue = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
        isCustomerOrInstanceVar = true;
      } else if (expr === 'shop.displayName' || expr === 'shop.name' || expr === 'store.displayName' || expr === 'shop' || expr === 'store') {
        if (!storeDisplayName) {
          logger.warn({ tenantId, executionId: execution.id }, 'Blocked step: shop display name is not configured');
          return { status: 'BLOCKED', reason: 'BLOCKED_SHOP_NAME_NOT_CONFIGURED' };
        }
        resolvedValue = storeDisplayName;
      } else if (expr === 'order.itemTitle' || expr === 'order.title' || expr === 'order.item' || expr === 'product.title' || expr === 'item' || expr === 'outfit') {
        resolvedValue = boutiqueJobDoc?.itemTitle || productDoc?.title || orderDoc?.items?.[0]?.title || '';
        isCustomerOrInstanceVar = true;
      } else if (expr === 'product.sku') {
        resolvedValue = productDoc?.sku || '';
        isCustomerOrInstanceVar = true;
      } else if (expr === 'product.price') {
        resolvedValue = productDoc ? `₹${(productDoc.pricePaise / 100).toLocaleString('en-IN')}` : '';
        isCustomerOrInstanceVar = true;
      } else if (expr === 'order.id') {
        resolvedValue = orderDoc?.id || boutiqueJobDoc?.id || '';
        isCustomerOrInstanceVar = true;
      } else if (expr === 'order.amount' || expr === 'order.netPaise') {
        resolvedValue = orderDoc ? `₹${(orderDoc.netPaise / 100).toLocaleString('en-IN')}` : '';
        isCustomerOrInstanceVar = true;
      } else if (expr === 'event.date' || expr === 'event.localDate' || expr === 'occasion.date') {
        resolvedValue = enrollment.occasionLocalDate || '';
        isCustomerOrInstanceVar = true;
      } else if (expr === 'offer.code' || expr === 'offer') {
        resolvedValue = (version as any).offerCode || '';
      } else if (expr.startsWith('literal:')) {
        resolvedValue = expr.slice(8);
      } else {
        // Disallow arbitrary customer.* or expr in customer!
        logger.warn({ expr, varKey }, 'Blocked unallowlisted variable binding');
        return { status: 'BLOCKED', reason: 'BLOCKED_MISSING_VARIABLE_BINDING' };
      }
    } else {
      // Default mappings by key name if not explicitly bound
      if (varKey === 'name') {
        resolvedValue = customer.firstName || '';
        isCustomerOrInstanceVar = true;
      } else if (varKey === 'shop' || varKey === 'store') {
        if (!storeDisplayName) {
          logger.warn({ tenantId, executionId: execution.id }, 'Blocked step: shop display name is not configured');
          return { status: 'BLOCKED', reason: 'BLOCKED_SHOP_NAME_NOT_CONFIGURED' };
        }
        resolvedValue = storeDisplayName;
      } else if (varKey === 'item' || varKey === 'outfit') {
        resolvedValue = boutiqueJobDoc?.itemTitle || productDoc?.title || orderDoc?.items?.[0]?.title || '';
        isCustomerOrInstanceVar = true;
      } else if (varKey === 'offer') {
        resolvedValue = (version as any).offerCode || '';
      } else {
        logger.warn({ varKey }, 'Blocked missing variable binding for required template variable');
        return { status: 'BLOCKED', reason: 'BLOCKED_MISSING_VARIABLE_BINDING' };
      }
    }

    if (!resolvedValue || resolvedValue.trim() === '') {
      if (isCustomerOrInstanceVar) {
        return { status: 'SKIP', reason: 'SKIPPED_MISSING_VARIABLE' };
      }
      return { status: 'BLOCKED', reason: 'BLOCKED_MISSING_VARIABLE_BINDING' };
    }

    parameters[varKey] = resolvedValue;
  }

  const payloadHash = sha256(parameters);

  // 8. Stale Frozen Intent Check (for retries, Spec p.20 & test C20)
  // "BLOCKED_STALE_INTENT when frozen-intent source data changes"
  if (execution.deliveryIntentId) {
    const existingIntent = await CampaignDeliveryIntentModel.findOne({
      id: execution.deliveryIntentId,
      tenantId
    });

    if (existingIntent) {
      let recipientPhone = '';
      try {
        recipientPhone = decryptText(existingIntent.encryptedRecipient);
      } catch {
        // cannot decrypt
      }

      const phoneChanged = recipientPhone && normalizeE164(customer.phone) !== normalizeE164(recipientPhone);
      const payloadChanged = existingIntent.payloadHash !== payloadHash;

      if (phoneChanged || payloadChanged) {
        logger.warn(
          { executionId: execution.id, phoneChanged, payloadChanged },
          'Source data changed for frozen intent; blocking execution as BLOCKED_STALE_INTENT'
        );
        return { status: 'BLOCKED', reason: 'BLOCKED_STALE_INTENT' };
      }
    }
  }

  // 9. Prerequisite Check (Page 8 & 19, test C13)
  if (stepDef.prerequisite === 'PREVIOUS_ACCEPTED') {
    const stepIndex = version.steps.findIndex((s) => s.stepId === stepId);
    if (stepIndex > 0) {
      const prevStepDef = version.steps[stepIndex - 1];
      const priorExecutions = await CampaignExecutionModel.find({
        tenantId,
        enrollmentId
      }).lean();

      const prevExecution = priorExecutions.find((e) => e.stepId === prevStepDef.stepId);
      if (!prevExecution) {
        // Previous step has not executed yet; defer
        const retryDue = new Date(serverNow.getTime() + 15 * 60 * 1000);
        if (retryDue < expiresAt) {
          return {
            status: 'DEFER',
            reason: 'WAITING_PREREQUISITE',
            nextDueAt: retryDue
          };
        }
        return { status: 'SKIP', reason: 'SKIPPED_PREREQUISITE_NOT_MET' };
      }

      const prevAccepted = ['PROVIDER_ACCEPTED', 'DELIVERED', 'READ'].includes(prevExecution.state);
      if (!prevAccepted) {
        const prevTerminalFailure = ['SKIPPED', 'FAILED', 'OUTCOME_UNKNOWN', 'BLOCKED'].includes(prevExecution.state);
        if (prevTerminalFailure) {
          return { status: 'SKIP', reason: 'SKIPPED_PREREQUISITE_NOT_MET' };
        }

        // Prior step might still be in progress (e.g. SCHEDULED, EVALUATING, DISPATCHING, DEFERRED, RETRY_WAIT); defer
        const retryDue = new Date(serverNow.getTime() + 15 * 60 * 1000);
        if (retryDue < expiresAt) {
          return {
            status: 'DEFER',
            reason: 'WAITING_PREREQUISITE',
            nextDueAt: retryDue
          };
        }
        return { status: 'SKIP', reason: 'SKIPPED_PREREQUISITE_NOT_MET' };
      }
    }
  }

  // 10. Allowed Send Hours & Blackout Preflight Check (Spec p.17, p.33, Finding 5)
  // Per spec Reason Precedence (Spec p.33), allowed hours & blackouts are evaluated after content readiness & prerequisite checks.
  // Transactional / ORDER_SERVICE campaigns are operational updates exempt from marketing send windows (Spec p.27).
  if (version.purpose === 'MARKETING') {
    const { TenantSettingsModel } = await import('../../models/TenantSettings.model');
    const tSettings = await TenantSettingsModel.findOne({ tenantId }).lean();
    if (tSettings && (tSettings.blackouts?.length || tSettings.allowedHours)) {
      const allowedHours = tSettings.allowedHours || { start: '10:00', end: '19:00' };
      const blackouts = tSettings.blackouts || [];
      const tz = tSettings.timezone || version.timezone || 'Asia/Kolkata';

      const hoursCheck = adjustForAllowedHoursAndBlackouts(
        serverNow,
        expiresAt,
        tz,
        allowedHours,
        blackouts
      );

      if (!hoursCheck.valid) {
        return { status: 'SKIP', reason: hoursCheck.reason || 'SKIPPED_BLACKOUT_EXPIRED' };
      }
      if (hoursCheck.adjustedDueAt.getTime() > serverNow.getTime()) {
        return {
          status: 'DEFER',
          reason: 'DEFERRED_ALLOWED_HOURS',
          nextDueAt: hoursCheck.adjustedDueAt
        };
      }
    }
  }

  // All preflight checks passed
  return {
    status: 'PROCEED',
    customer,
    version,
    enrollment,
    campaign,
    parameters,
    payloadHash
  };
}

export const runSafeguardPipeline = executePreflightSafeguards;
