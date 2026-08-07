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
        `Sent "${templateName}" to ${to} (provider id: ${result.providerMessageId})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send email "${templateName}" to ${to}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      // Re‑throw so BullMQ marks the job as failed and applies retry logic
      throw err;
    }
  }
}