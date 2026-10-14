import { IWhatsAppDeliveryAdapter } from './deliveryAdapter.interface';
import { mockWhatsAppAdapter } from './mockWhatsAppAdapter';
import { WhatsAppSandboxDeliveryAdapter } from './sandboxWhatsAppAdapter';
import { env } from '../../../config/env';

export function getWhatsAppDeliveryAdapter(): IWhatsAppDeliveryAdapter {
  if (env.WHATSAPP_MODE === 'sandbox') {
    return new WhatsAppSandboxDeliveryAdapter();
  }
  return mockWhatsAppAdapter;
}
