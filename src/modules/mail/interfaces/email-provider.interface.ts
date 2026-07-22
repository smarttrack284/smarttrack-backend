export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type SendEmailResult = {
  providerMessageId: string;
};

/**
 * Every concrete provider (Resend, SendGrid, SES, ...) implements this one
 * interface. MailProcessor and everything upstream of it only ever talks
 * to EmailProvider — swapping providers later is writing one new class and
 * changing the factory in mail.module.ts, nothing else in the module.
 */
export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

export const RESEND_EMAIL_PROVIDER = Symbol('RESEND_EMAIL_PROVIDER');
