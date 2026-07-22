import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MAIL_QUEUE_NAME } from './constants/mail-queue.constant';
import { RESEND_EMAIL_PROVIDER } from './interfaces/email-provider.interface';
import { ResendEmailProvider } from './providers/resend-email.provider';
import { MailTemplateService } from './mail-template.service';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE_NAME })],
  providers: [
    {
      provide: RESEND_EMAIL_PROVIDER,
      useClass: ResendEmailProvider,
    },
    MailTemplateService,
    MailProcessor,
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
