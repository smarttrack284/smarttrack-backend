import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MAIL_QUEUE_NAME, MailJobName } from './constants/mail-queue.constant';
import type {
  MailTemplate,
  MailTemplateContextMap,
} from './interfaces/mail-template.interface';

@Injectable()
export class MailService {
  constructor(
    @InjectQueue(MAIL_QUEUE_NAME) private readonly mailQueue: Queue,
  ) {}

  /**
   * Enqueues an email — returns as soon as the job is queued, NOT once the
   * email is actually delivered. This is what decouples a caller like
   * TeamService.inviteMember from provider latency/downtime; the queue and
   * MailProcessor handle retries independently of the original request.
   */
  async sendTemplateEmail<T extends MailTemplate>(params: {
    to: string;
    subject: string;
    templateName: T;
    context: MailTemplateContextMap[T];
  }): Promise<void> {
    await this.mailQueue.add(
      MailJobName.SEND_TEMPLATE_EMAIL,
      {
        to: params.to,
        subject: params.subject,
        templateName: params.templateName,
        context: params.context,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000, // keep recent job history bounded, not unlimited
        removeOnFail: 5000,
      },
    );
  }
}
