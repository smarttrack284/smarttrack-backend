import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  type EmailProvider,
  RESEND_EMAIL_PROVIDER,
} from './interfaces/email-provider.interface';
import { MailTemplateService } from './mail-template.service';
import { MailTemplate } from './interfaces/mail-template.interface';
import {
  MAIL_QUEUE_NAME,
  MailJobName,
  type SendTemplateEmailJobData,
} from './constants/mail-queue.constant';

/**
 * Masks the local part of an email address, keeping the domain.
 * e.g., "john.doe@gmail.com" → "j***@gmail.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***'; // fallback
  const visible = local.charAt(0);
  const maskedLocal = visible + '***';
  return `${maskedLocal}@${domain}`;
}

@Processor(MAIL_QUEUE_NAME, {
  concurrency: 5,
  limiter: { max: 10, duration: 1000 },
})
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    @Inject(RESEND_EMAIL_PROVIDER)
    private readonly resendEmailProvider: EmailProvider,
    private readonly templateService: MailTemplateService,
  ) {
    super();
  }

  async process(job: Job<SendTemplateEmailJobData>): Promise<void> {
    if (job.name !== MailJobName.SEND_TEMPLATE_EMAIL) return;

    const { to, subject, templateName, context } = job.data;
    const maskedRecipient = maskEmail(to);

    try {
      const html = this.templateService.render(
        templateName as MailTemplate,
        context as never,
      );

      const result = await this.resendEmailProvider.sendEmail({
        to,
        subject,
        html,
      });

      this.logger.log(
        `Sent email "${templateName}" to ${maskedRecipient} (provider id: ${result.providerMessageId})`,
      );
    } catch (err) {
      this.logger.error({
        msg: `Failed to send email "${templateName}" to ${maskedRecipient}`,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        templateName,
        maskedRecipient,
      });
      // Re‑throw so BullMQ marks the job as failed and applies retry logic
      throw err;
    }
  }
}