import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import { WebhookEndpoint } from '#/common/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '#/common/entities/webhook-delivery.entity';
import { WebhookDeliveryStatus } from '#/common/constants/webhook-delivery-status.constant';
import {
  computeWebhookSignature,
  decryptWebhookSecret,
} from '#/common/utils/webhook-secret.util';
import {
  type DeliverWebhookJobData,
  WEBHOOK_QUEUE_NAME,
  WebhookJobName,
} from './constants/webhook-queue.constant';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  resolveAndValidateWebhookHost,
  WebhookHostBlockedError,
} from '#/common/utils/resolve-webhook-host.util';
import { isIP } from 'node:net';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY_CHARS = 1000;

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

    // ---------- 1. Load endpoint ----------
    let endpoint: WebhookEndpoint | null;
    try {
      endpoint = await this.endpointRepo.findOne({
        where: { id: webhookEndpointId },
      });
    } catch (err) {
      this.logger.error(
        `Failed to load endpoint ${webhookEndpointId} – retrying later`,
        (err as Error).stack,
      );
      throw err; // transient DB error – retry
    }

    if (!endpoint || !endpoint.isActive) {
      this.logger.log(`Endpoint ${webhookEndpointId} is gone or inactive – job skipped`);
      return;
    }

    // ---------- 2. Create delivery record ----------
    const deliveryRow = this.deliveryRepo.create({
      webhookEndpointId,
      eventId,
      eventType: eventType as any,
      payload,
      attemptNumber,
      status: WebhookDeliveryStatus.PENDING,
    });
    try {
      await this.deliveryRepo.save(deliveryRow);
    } catch (err) {
      this.logger.error(
        `Failed to insert delivery row for event ${eventId} – retrying`,
        (err as Error).stack,
      );
      throw err;
    }

    // ---------- 3. Prepare signature ----------
    const rawBody = JSON.stringify({
      id: eventId,
      type: eventType,
      data: payload,
      createdAt: new Date().toISOString(),
    });
    const timestamp = Math.floor(Date.now() / 1000);
    let secret: string;
    try {
      secret = decryptWebhookSecret(endpoint.secretEncrypted);
    } catch (err) {
      // Corrupted secret – permanent failure, no retries
      deliveryRow.status = WebhookDeliveryStatus.FAILED;
      deliveryRow.errorMessage = 'Webhook secret is corrupted – cannot sign request';
      await this.deliveryRepo.save(deliveryRow).catch(() => {});
      this.logger.error(
        `Decryption failed for endpoint ${webhookEndpointId} – permanent failure`,
        (err as Error).stack,
      );
      return;
    }
    const signature = computeWebhookSignature(secret, timestamp, rawBody);

    // ---------- 4. DNS resolution & pinning ----------
    const targetUrl = new URL(endpoint.url);
    let resolvedIp: string;
    try {
      resolvedIp = await resolveAndValidateWebhookHost(targetUrl.hostname);
    } catch (err) {
      if (err instanceof WebhookHostBlockedError) {
        deliveryRow.status = WebhookDeliveryStatus.FAILED;
        deliveryRow.errorMessage = err.message;
        await this.deliveryRepo.save(deliveryRow).catch(() => {});
        this.logger.warn(
          `Blocked webhook delivery to ${webhookEndpointId}: ${err.message}`,
        );
        return; // no retry
      }
      // Unresolvable host – transient, retry later
      this.logger.warn(
        `Could not resolve host for endpoint ${webhookEndpointId} – will retry`,
      );
      throw err;
    }

    // Pin IP – use isIP to correctly determine address family
    const family = isIP(resolvedIp) === 6 ? 6 : 4;
    const pinnedAgent = new Agent({
      connect: {
        lookup: (_hostname, _opts, callback) => {
          callback(null, [{ address: resolvedIp, family }]);
        },
      },
    });

    // ---------- 5. Perform HTTP request ----------
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
        // Non‑2xx – retry via BullMQ
        throw new Error(`Webhook endpoint responded with status ${res.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delivery failed';
      deliveryRow.status = WebhookDeliveryStatus.FAILED;
      deliveryRow.errorMessage = message.slice(0, 500);
      await this.deliveryRepo.save(deliveryRow).catch(() => {});
      this.logger.warn(
        `Webhook delivery failed for endpoint ${webhookEndpointId}: ${message}`,
      );
      throw err; // trigger BullMQ retry
    } finally {
      clearTimeout(timeout);
    }
  }
}