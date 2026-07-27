import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import { WebhookEndpoint } from '#/common/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '#/common/entities/webhook-delivery.entity';
import { WebhookDeliveryStatus } from '#/common/constants/webhook-delivery-status.constant';
import { computeWebhookSignature, decryptWebhookSecret, } from '#/common/utils/webhook-secret.util';
import { type DeliverWebhookJobData, WEBHOOK_QUEUE_NAME, WebhookJobName, } from './constants/webhook-queue.constant';
import { Agent, fetch as undiciFetch } from 'undici';
import { resolveAndValidateWebhookHost, WebhookHostBlockedError, } from '#/common/utils/resolve-webhook-host.util';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY_CHARS = 1000;

/**
 * Concurrency capped so a burst of events (e.g. bulk CSV import) can't
 * spawn hundreds of simultaneous outbound HTTP calls at once — same
 * reasoning as MailProcessor's concurrency cap.
 */
@Processor(WEBHOOK_QUEUE_NAME, { concurrency: 10 })
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    @InjectRepository(WebhookEndpoint)
    private readonly endpointRepo: Repository<WebhookEndpoint>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
  ) {
    super();
  }

  async process(job: Job<DeliverWebhookJobData>): Promise<void> {
    if (job.name !== WebhookJobName.DELIVER) return;
    const { webhookEndpointId, eventId, eventType, payload, attemptNumber } =
      job.data;

    const endpoint = await this.endpointRepo.findOne({
      where: { id: webhookEndpointId },
    });
    // Endpoint deleted/deactivated between enqueue and processing — nothing to deliver to.
    if (!endpoint || !endpoint.isActive) return;

    const deliveryRow = this.deliveryRepo.create({
      webhookEndpointId,
      eventId,
      eventType: eventType as any,
      payload,
      attemptNumber,
      status: WebhookDeliveryStatus.PENDING,
    });
    await this.deliveryRepo.save(deliveryRow);

    const rawBody = JSON.stringify({
      id: eventId,
      type: eventType,
      data: payload,
      createdAt: new Date().toISOString(),
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = decryptWebhookSecret(endpoint.secretEncrypted);
    const signature = computeWebhookSignature(secret, timestamp, rawBody);

    const targetUrl = new URL(endpoint.url);
    let resolvedIp: string;
    try {
      resolvedIp = await resolveAndValidateWebhookHost(targetUrl.hostname);
    } catch (err) {
      if (err instanceof WebhookHostBlockedError) {
        deliveryRow.status = WebhookDeliveryStatus.FAILED;
        deliveryRow.errorMessage = err.message;
        await this.deliveryRepo.save(deliveryRow);
        this.logger.warn(
          `Blocked webhook delivery to ${webhookEndpointId}: ${err.message}`,
        );
        return; // do NOT throw — this must never trigger a retry, the target is unsafe by design, retrying won't fix that
      }
      throw err;
    }

    // Pin the connection to the exact IP we just validated, via a custom
    // lookup function on undici's Agent — this is what prevents a SECOND,
    // independent DNS resolution from happening at actual connect time
    // (which is exactly where the rebinding race would otherwise reopen).
    const pinnedAgent = new Agent({
      connect: {
        lookup: (_hostname, _opts, callback) => {
          callback(null, [
            {
              address: resolvedIp,
              family: targetUrl.hostname.includes(':') ? 6 : 4,
            },
          ]);
        },
      },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await undiciFetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Id': eventId,
          'X-Webhook-Event': eventType,
          'X-Webhook-Signature': `t=${timestamp},v1=${signature}`,
        },
        body: rawBody,
        signal: controller.signal,
        dispatcher: pinnedAgent,
      });

      const responseText = (await res.text()).slice(0, MAX_RESPONSE_BODY_CHARS);
      const success = res.status >= 200 && res.status < 300;

      deliveryRow.status = success
        ? WebhookDeliveryStatus.SUCCESS
        : WebhookDeliveryStatus.FAILED;
      deliveryRow.httpStatusCode = res.status;
      deliveryRow.responseBody = responseText;
      deliveryRow.deliveredAt = success ? new Date() : null;
      await this.deliveryRepo.save(deliveryRow);

      if (!success) {
        // Throwing lets BullMQ's own attempts/backoff config (set on the
        // job in WebhooksDispatcherService) drive retries — this
        // processor doesn't re-implement retry scheduling itself.
        throw new Error(`Webhook endpoint responded with status ${res.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delivery failed';
      deliveryRow.status = WebhookDeliveryStatus.FAILED;
      deliveryRow.errorMessage = message.slice(0, 500);
      await this.deliveryRepo.save(deliveryRow);
      this.logger.warn(
        `Webhook delivery failed for endpoint ${webhookEndpointId}: ${message}`,
      );
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
