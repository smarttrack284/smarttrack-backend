import { Controller, Headers, Post, RawBody } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PaystackWebhookHandlerService } from '#/modules/subscriptions/paystack-webhook-handler.service';

@Controller('webhooks/paystack')
@SkipThrottle()
export class PaystackWebhookController {
  constructor(private readonly handler: PaystackWebhookHandlerService) {}

  @Post()
  async handle(
    @RawBody() rawBody: Buffer,
    @Headers('x-paystack-signature') signature: string,
  ): Promise<void> {
    await this.handler.handle(rawBody, signature);
  }
}
