import { IWhatsAppDeliveryAdapter, SendCampaignStepParams, SendStepResult } from './deliveryAdapter.interface';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';

export class WhatsAppSandboxDeliveryAdapter implements IWhatsAppDeliveryAdapter {
  private phoneNumberId: string;
  private accessToken: string;

  constructor(phoneNumberId?: string, accessToken?: string) {
    this.phoneNumberId = phoneNumberId || (process.env.WHATSAPP_PHONE_NUMBER_ID || '');
    this.accessToken = accessToken || (process.env.WHATSAPP_ACCESS_TOKEN || '');
  }

  async sendCampaignStep(params: SendCampaignStepParams): Promise<SendStepResult> {
    const recipient = params.recipientPhone;

    if (!recipient) {
      return {
        success: false,
        state: 'REJECTED',
        errorCode: 'MISSING_RECIPIENT_PHONE',
        errorMessage: 'Recipient phone number is required at the delivery boundary'
      };
    }

    if (!this.phoneNumberId || !this.accessToken) {
      return {
        success: false,
        state: 'REJECTED',
        errorCode: 'SANDBOX_NOT_CONFIGURED',
        errorMessage: 'WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN must be configured in .env'
      };
    }

    // Clean phone number (strip spaces, dashes, leading plus for Meta Cloud API format)
    const cleanPhone = recipient.replace(/[^0-9]/g, '');

    // In Meta Developer Sandbox, pre-approved test templates like "hello_world" or registered templates are used
    const templateName = params.template.id.includes('birthday') ? 'hello_world' : params.template.id;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: 'en_US'
        }
      }
    };

    logger.info(
      {
        executionId: params.executionId,
        to: cleanPhone,
        templateName,
        phoneNumberId: this.phoneNumberId
      },
      'WhatsAppSandboxDeliveryAdapter dispatching to Meta Cloud API'
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);
      const data = await response.json();

      if (!response.ok) {
        logger.error({ status: response.status, data }, 'Meta Cloud API returned error');
        return {
          success: false,
          state: 'REJECTED',
          errorCode: data.error?.code?.toString() || 'PROVIDER_ERROR',
          errorMessage: data.error?.message || 'Meta Cloud API error',
          rawResponse: data
        };
      }

      const providerMessageId = data.messages?.[0]?.id || `wamid.${Date.now()}`;
      return {
        success: true,
        state: 'ACCEPTED',
        providerMessageId,
        rawResponse: data
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        logger.warn({ executionId: params.executionId }, 'Meta Cloud API timed out (10s)');
        return {
          success: false,
          state: 'OUTCOME_UNKNOWN',
          errorCode: 'NETWORK_TIMEOUT',
          errorMessage: 'Request to Meta Graph API timed out. Marked OUTCOME_UNKNOWN to prevent double send.'
        };
      }

      logger.error({ err }, 'Network error calling Meta Cloud API');
      return {
        success: false,
        state: 'OUTCOME_UNKNOWN',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err.message
      };
    }
  }
}
