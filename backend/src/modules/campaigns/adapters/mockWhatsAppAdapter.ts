import { IWhatsAppDeliveryAdapter, SendCampaignStepParams, SendStepResult } from './deliveryAdapter.interface';
import { getApprovedTemplate } from './templateCatalogue';
import { logger } from '../../../config/logger';
import { ulid } from 'ulid';

export class MockWhatsAppDeliveryAdapter implements IWhatsAppDeliveryAdapter {
  private submissions: SendCampaignStepParams[] = [];
  private forcedState: 'AUTO' | 'FORCE_REJECT' | 'FORCE_TIMEOUT' = 'AUTO';

  async sendCampaignStep(params: SendCampaignStepParams): Promise<SendStepResult> {
    this.submissions.push(params);

    logger.info(
      {
        executionId: params.executionId,
        templateId: params.template.id,
        connectionId: params.connectionId,
        submissionIndex: this.submissions.length
      },
      'MockWhatsAppDeliveryAdapter received step dispatch'
    );

    // Verify template existence in approved catalogue
    const template = getApprovedTemplate(params.template.id);
    if (!template) {
      return {
        success: false,
        state: 'REJECTED',
        errorCode: 'TEMPLATE_NOT_FOUND',
        errorMessage: `Template ${params.template.id} does not exist in the approved catalogue`
      };
    }

    if (template.status === 'PAUSED') {
      return {
        success: false,
        state: 'REJECTED',
        errorCode: 'TEMPLATE_PAUSED',
        errorMessage: `Template ${params.template.id} is paused by the provider`
      };
    }

    if (this.forcedState === 'FORCE_REJECT') {
      return {
        success: false,
        state: 'REJECTED',
        errorCode: 'PROVIDER_REJECTED',
        errorMessage: 'Simulated permanent provider rejection'
      };
    }

    if (this.forcedState === 'FORCE_TIMEOUT') {
      return {
        success: false,
        state: 'OUTCOME_UNKNOWN',
        errorCode: 'NETWORK_TIMEOUT',
        errorMessage: 'Simulated network timeout during provider call'
      };
    }

    // Standard simulated success
    const providerMessageId = `wamid.HBgL${ulid()}`;
    return {
      success: true,
      state: 'ACCEPTED',
      providerMessageId,
      rawResponse: {
        messaging_product: 'whatsapp',
        contacts: [{ input: 'recipient_phone', wa_id: 'wa_id_mock' }],
        messages: [{ id: providerMessageId, message_status: 'accepted' }]
      }
    };
  }

  getSubmissions(): SendCampaignStepParams[] {
    return [...this.submissions];
  }

  getSubmissionCount(): number {
    return this.submissions.length;
  }

  setForcedState(state: 'AUTO' | 'FORCE_REJECT' | 'FORCE_TIMEOUT'): void {
    this.forcedState = state;
  }

  clearSubmissions(): void {
    this.submissions = [];
    this.forcedState = 'AUTO';
  }
}

export const mockWhatsAppAdapter = new MockWhatsAppDeliveryAdapter();
