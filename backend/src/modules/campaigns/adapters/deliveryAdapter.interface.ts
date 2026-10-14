export interface SendCampaignStepParams {
  executionId: string;
  deliveryKey: string;
  connectionId: string;
  customerId: string;
  recipientVersion: number;
  template: {
    id: string;
    revision: number;
    language: string;
  };
  parameters: Record<string, string>;
  expiresAt: Date;
  recipientPhone?: string; // Decrypted phone passed only at the delivery boundary
}

export type DeliveryOutcomeState = 'ACCEPTED' | 'REJECTED' | 'OUTCOME_UNKNOWN';

export interface SendStepResult {
  success: boolean;
  state: DeliveryOutcomeState;
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  rawResponse?: any;
}

export interface IWhatsAppDeliveryAdapter {
  sendCampaignStep(params: SendCampaignStepParams): Promise<SendStepResult>;
}
