import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from './interfaces/email-provider.interface';
import { MailTemplateService } from './mail-template.service';
import { MailTemplate } from './interfaces/mail-template.interface';
import {
  MAIL_QUEUE_NAME,
  MailJobName,
  type SendTemplateEmailJobData,
} from './constants/mail-queue.constant';

/**
 * The actual sender. Concurrency is capped via @Processor's `concurrency`
 * option below — this is the direct fix for "too many concurrent sends":
 * even if 500 jobs are enqueued at once (e.g. a dispatcher batch-updating
 * many orders), only N jobs run at a time, and BullMQ's rate limiter caps
 * how many complete per time window, which is what actually protects
 * against hitting the email provider's own rate limit.
 */
@Processor(MAIL_QUEUE_NAME, {
  concurrency: 5,
  limiter: { max: 10, duration: 1000 }, // at most 10 emails/sec — tune to your actual provider plan's limit
})
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly templateService: MailTemplateService,
  ) {
    super();
  }

  async process(job: Job<SendTemplateEmailJobData>): Promise<void> {
    if (job.name !== MailJobName.SEND_TEMPLATE_EMAIL) return;

    const { to, subject, templateName, context } = job.data;
    const html = this.templateService.render(
      templateName as MailTemplate,
      context as never,
    );

    const result = await this.emailProvider.sendEmail({ to, subject, html });
    this.logger.log(
      `Sent "${templateName}" to ${to} (provider id: ${result.providerMessageId})`,
    );
  }
}
