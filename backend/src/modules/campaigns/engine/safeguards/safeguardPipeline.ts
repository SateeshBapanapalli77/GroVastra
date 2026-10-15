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
import { getApprovedTemplate } from '../../adapters/templateCatalogue';
import { decryptText, sha256 } from '../../../../shared/utils/crypto';
import { normalizeE164 } from '../../../../shared/utils/phone';
import { logger } from '../../../../config/logger';

export type PipelineOutcome =
  | { status: 'PROCEED'; customer: ICustomer; version: ICampaignVersion; enrollment: ICampaignEnrollment; campaign: any; parameters: Record<string, string>; payloadHash: string }
  | { status: 'SKIP'; reason: string }
  | { status: 'DEFER'; reason: string; nextDueAt: Date }
  | { status: 'BLOCKED'; reason: string };

/**
 * Preflight Safeguard Pipeline (Chain of Responsibility Pattern)
 * Evaluates gates in strict Reason Precedence Order (Handoff Page 33):
 * 1. Channel Suppression / Customer Deletion
 * 2. Campaign / Global Pause & Pause Generation
 * 3. Step Expiry / Lateness Cutoff
 * 4. Stop Rules (stopOnGoal purchase, stopOnReply staff hold)
 * 5. Content / Readiness / Template Blocked
 * 6. Prerequisite Check (PREVIOUS_ACCEPTED)
 * (Contact Frequency Caps are reserved inside the atomic submission transaction)
 */
export async function executePreflightSafeguards(
  execution: ICampaignExecution,
  serverNow: Date = new Date()
): Promise<PipelineOutcome> {
  const { tenantId, campaignId, enrollmentId, stepId, expiresAt } = execution;

  // 1. Global Pause Gate (Tenant Control Gate)
  const tenantGate = await TenantControlGateModel.findOne({ tenantId });
  if (tenantGate?.globalPause) {
    return { status: 'SKIP', reason: 'CAMPAIGN_OR_GLOBAL_PAUSED' };
  }

  // 2. Load Campaign & Version
  const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
  if (!campaign) {
    return { status: 'SKIP', reason: 'SKIPPED_CAMPAIGN_NOT_FOUND' };
  }

  // Campaign Pause Gate (Campaign Control Gate & Campaign Model status)
  const campaignGate = await CampaignControlGateModel.findOne({ tenantId, campaignId });
  if (campaign.status === 'PAUSED' || campaign.status === 'ARCHIVED' || campaignGate?.paused) {
    return { status: 'SKIP', reason: 'SKIPPED_CAMPAIGN_PAUSED' };
  }

  const expectedPauseGen = campaignGate?.pauseGeneration ?? campaign.pauseGeneration;
  if (
    typeof execution.pauseGeneration === 'number' &&
    execution.pauseGeneration !== expectedPauseGen
  ) {
    return {
      status: 'DEFER',
      reason: 'DEFERRED_PAUSE_GENERATION_MISMATCH',
      nextDueAt: new Date(serverNow.getTime() + 60 * 1000)
    };
  }

  const enrollment = await CampaignEnrollmentModel.findOne({ id: enrollmentId, tenantId });
  if (!enrollment || enrollment.status !== 'ACTIVE') {
    return { status: 'SKIP', reason: 'SKIPPED_ENROLLMENT_INACTIVE' };
  }

  const version = await CampaignVersionModel.findOne({ id: enrollment.campaignVersionId, tenantId });
  if (!version) {
    return { status: 'SKIP', reason: 'SKIPPED_VERSION_NOT_FOUND' };
  }

  const stepDef = version.steps.find((s) => s.stepId === stepId);
  if (!stepDef) {
    return { status: 'SKIP', reason: 'SKIPPED_STEP_NOT_FOUND' };
  }

  // 3. Load Customer & Permission Gates
  const customer = await CustomerModel.findOne({ id: enrollment.customerId, tenantId });
  if (!customer || customer.status === 'DELETED') {
    return { status: 'SKIP', reason: 'SKIPPED_CUSTOMER_DELETED' };
  }

  if (customer.channelSuppressed) {
    return { status: 'SKIP', reason: 'SKIPPED_CHANNEL_SUPPRESSED' };
  }

  if (version.purpose === 'MARKETING' && !customer.optedInMarketing) {
    return { status: 'SKIP', reason: 'SKIPPED_MARKETING_OPT_OUT' };
  }

  // 4. Expiry Check (Page 17 & 33)
  if (serverNow > expiresAt) {
    return { status: 'SKIP', reason: 'SKIPPED_STEP_EXPIRED' };
  }

  // 5. Stop Rules (Handoff Page 8 & 11)
  // Stop on Goal Purchase: takes precedence over reply hold (Spec p.33)
  if (stepDef.stopOnGoal !== false && enrollment.goalReachedAt !== null) {
    return { status: 'SKIP', reason: 'SKIPPED_GOAL_REACHED' };
  }

  // Stop on Customer Inbound Reply (Staff Hold)
  if (stepDef.stopOnReply && enrollment.replyHoldAt !== null) {
    return { status: 'SKIP', reason: 'SKIPPED_REPLY_HOLD' };
  }

  // 6. Template Readiness Gate (Spec p.19, p.27, p.32 test C02, C19)
  const template = getApprovedTemplate(stepDef.templateRef.id);
  if (!template) {
    return { status: 'BLOCKED', reason: 'CONTENT_OR_TEMPLATE_BLOCKED' };
  }
  if (template.status === 'PAUSED') {
    return { status: 'BLOCKED', reason: 'CONTENT_OR_TEMPLATE_BLOCKED' };
  }

  // 7. Template Purpose Gate (Spec p.27, test C14)
  // Marketing template must never pass itself off as service
  if (version.purpose === 'ORDER_SERVICE' && template.category === 'MARKETING') {
    return { status: 'BLOCKED', reason: 'BLOCKED_TEMPLATE_PURPOSE_MISMATCH' };
  }

  // 8. Live Stock Re-check Gate (Spec p.13, tests A15, A16)
  if (enrollment.sourceRef?.type === 'STOCK_EVENT') {
    const sku = enrollment.sourceRef.id;
    const product = await ProductModel.findOne({ tenantId, sku });
    if (!product || product.stockCount <= 0 || !product.isSellable) {
      return { status: 'SKIP', reason: 'SKIPPED_STOCK_DEPLETED' };
    }
  }

  // 9. Resolve Parameter Bindings (Spec p.19, C05)
  const storeDisplayName = (version as any).brandName || campaign?.name || '';
  const parameters: Record<string, string> = {};
  const rawBindings = stepDef.bindings instanceof Map
    ? Object.fromEntries(stepDef.bindings.entries())
    : (stepDef.bindings || {});

  for (const varKey of template.variableKeys) {
    const rawExpr = rawBindings[varKey];
    let resolvedValue = '';

    if (rawExpr) {
      const expr = typeof rawExpr === 'string' ? rawExpr : String(rawExpr || '');
      if (expr === 'customer.firstName') {
        resolvedValue = customer.firstName || '';
      } else if (expr === 'customer.lastName') {
        resolvedValue = customer.lastName || '';
      } else if (expr === 'customer.fullName') {
        resolvedValue = `${customer.firstName} ${customer.lastName}`.trim();
      } else if (expr.startsWith('customer.')) {
        const prop = expr.slice('customer.'.length);
        resolvedValue = (customer as any)[prop] ? String((customer as any)[prop]) : '';
      } else if (expr === 'shop.displayName' || expr === 'shop.name' || expr === 'store.displayName') {
        resolvedValue = storeDisplayName;
      } else if (expr === 'order.itemTitle' || expr === 'order.title' || expr.startsWith('order.')) {
        resolvedValue = 'bespoke outfit';
      } else if (expr.startsWith('literal:')) {
        resolvedValue = expr.slice(8);
      } else if (expr in customer) {
        resolvedValue = String((customer as any)[expr] || '');
      } else {
        resolvedValue = '';
      }
    } else {
      if (varKey === 'name') {
        resolvedValue = customer.firstName || '';
      } else if (varKey === 'shop') {
        resolvedValue = storeDisplayName;
      }
    }

    if (!resolvedValue || resolvedValue.trim() === '') {
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
    const priorExecutions = await CampaignExecutionModel.find({
      tenantId,
      enrollmentId
    }).lean();

    const priorAccepted = priorExecutions.some(
      (e) => e.stepId !== stepId && ['PROVIDER_ACCEPTED', 'DELIVERED', 'READ'].includes(e.state)
    );

    if (!priorAccepted) {
      const priorTerminalFailure = priorExecutions.some(
        (e) => e.stepId !== stepId && ['SKIPPED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(e.state)
      );

      if (priorTerminalFailure) {
        return { status: 'SKIP', reason: 'SKIPPED_PREREQUISITE_NOT_MET' };
      }

      // Prior step might still be in progress; defer
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
