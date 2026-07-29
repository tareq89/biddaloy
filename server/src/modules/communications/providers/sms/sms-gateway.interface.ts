import { CommunicationSendResult } from '../communication-provider.interface';

export interface SmsGateway {
  sendSms(to: string, message: string): Promise<CommunicationSendResult>;
}

/** SMS gateway text is non-ASCII (Bangla) -> gateways bill/segment it as unicode SMS. */
export function isUnicodeMessage(message: string): boolean {
  return /[^\x00-\x7F]/.test(message);
}
