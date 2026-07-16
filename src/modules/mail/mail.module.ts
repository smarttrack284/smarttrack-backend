import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { MAIL_QUEUE_NAME } from './constants/mail-queue.constant';
import { EMAIL_PROVIDER } from './interfaces/email-provider.interface';
import { ResendEmailProvider } from './providers/resend-email.provider';
import { MailTemplateService } from './mail-template.service';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL'),
        },
      }),
    }),
    BullModule.registerQueue({ name: MAIL_QUEUE_NAME }),
  ],
  providers: [
    {
      // Provider selection point — today this always resolves to Resend.
      // Adding SendGrid/SES later means writing that class and branching
      // here on a MAIL_PROVIDER env var; nothing else in the module changes.
      provide: EMAIL_PROVIDER,
      useClass: ResendEmailProvider,
    },
    MailTemplateService,
    MailProcessor,
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
