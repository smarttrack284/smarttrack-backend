export const MAIL_QUEUE_NAME = 'mail';

export enum MailJobName {
  SEND_TEMPLATE_EMAIL = 'send-template-email',
}

export type SendTemplateEmailJobData = {
  to: string;
  subject: string;
  templateName: string;
  context: Record<string, unknown>;
};
