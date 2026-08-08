import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { MailService } from '#/modules/mail/mail.service';
import { MailTemplate } from '#/modules/mail/interfaces/mail-template.interface';
import { TeamRoleType } from '#/common/types/team-role.type';
import { SubscriptionPlan, SubscriptionStatus, } from '#/common/constants/subscription-plan.constant';
import { format } from 'date-fns';
import {
  sendExpirationRemindersJobData,
  SUBSCRIPTION_REMINDER_QUEUE_NAME,
  SubscriptionReminderJobName,
} from './constants/subscription-reminder-queue.constant';
import { ConfigService } from '@nestjs/config';

@Processor(SUBSCRIPTION_REMINDER_QUEUE_NAME, { concurrency: 5 })
export class SubscriptionReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(SubscriptionReminderProcessor.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<sendExpirationRemindersJobData>): Promise<void> {
    if (job.name !== SubscriptionReminderJobName.SEND_EXPIRY_REMINDER) return;

    const { subscriptionId, companyId } = job.data;
    try {
      const subscription = await this.subscriptionRepo.findOne({
        where: { id: subscriptionId },
      });
      if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE)
        return;

      // Idempotency guard – already sent in the last 24 hours?
      if (subscription.wasReminderRecentlySent()) {
        this.logger.log(
          `Skipping duplicate reminder for subscription ${subscriptionId}`,
        );
        return;
      }

      const ownerRole = await this.userRoleRepo.findOne({
        where: { companyId, role: TeamRoleType.OWNER },
      });
      if (!ownerRole?.email) return;

      const company = await this.companyRepo.findOne({
        where: { id: companyId },
      });
      const companyName = company?.name ?? 'SmartTrack';
      const planName =
        subscription.plan === SubscriptionPlan.PRO ? 'Pro' : 'Starter';
      const expiryDate = subscription.currentPeriodEnd
        ? format(new Date(subscription.currentPeriodEnd), 'MMMM d, yyyy')
        : 'soon';
      const renewalUrl = `${process.env.CLIENT_URL}/dashboard/billing`;
      const supportEmail =
        this.config.get<string>('SUPPORT_EMAIL') ?? 'help@smarttrack.com';

      await this.mailService.sendTemplateEmail({
        to: ownerRole.email,
        subject: `Your ${planName} plan expires on ${expiryDate}`,
        templateName: MailTemplate.SUBSCRIPTION_EXPIRING,
        context: {
          companyName,
          customerName: ownerRole.name ?? 'there',
          planName,
          expiryDate,
          renewalUrl,
          supportEmail,
          year: new Date().getFullYear(),
        },
      });

      // Mark the reminder as sent
      subscription.markReminderSent();
      await this.subscriptionRepo.save(subscription);

      this.logger.log(`Sent expiry reminder to ${ownerRole.email}`);
    } catch (err) {
      this.logger.error(
        `Failed to process reminder job ${job.id}`,
        (err as Error).stack,
      );
      throw err; // BullMQ will retry
    }
  }
}
