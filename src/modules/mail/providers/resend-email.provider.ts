import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { ExternalServiceException } from '#/common/exceptions';
import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from '../interfaces/email-provider.interface';

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    this.client = new Resend(apiKey);
    this.fromAddress =
      this.config.get<string>('MAIL_FROM_ADDRESS') ??
      'notifications@example.com';
    this.fromName = this.config.get<string>('MAIL_FROM_NAME') ?? 'SmartTrack';
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const { data, error } = await this.client.emails.send({
      from: `${this.fromName} <${this.fromAddress}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (error || !data) {
      // Thrown inside a BullMQ worker, not an HTTP request — this doesn't
      // go through Nest's GlobalExceptionFilter, it's just a normal thrown
      // Error that BullMQ catches to trigger a retry per the queue's
      // backoff config.
      throw new ExternalServiceException('Resend', error?.message);
    }

    return { providerMessageId: data.id };
  }
}
