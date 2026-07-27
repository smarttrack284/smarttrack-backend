// src/modules/webhooks/webhooks.service.ts
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { WebhookEndpoint } from '#/common/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '#/common/entities/webhook-delivery.entity';
import { WebhookEventType } from '#/common/constants/webhook-event.constant';
import { encryptWebhookSecret, generateWebhookSecret, } from '#/common/utils/webhook-secret.util';
import { validateWebhookUrl } from '#/common/utils/webhook-url-validator.util';
import { ForbiddenAppException, ResourceNotFoundException, } from '#/common/exceptions';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { ListWebhookDeliveriesQueryDto } from './dto/list-webhook-deliveries.query.dto';
import { WEBHOOK_QUEUE_NAME, WebhookJobName, } from './constants/webhook-queue.constant';

const MAX_ENDPOINTS_PER_COMPANY = 10;

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(WebhookEndpoint)
    private readonly endpointRepo: Repository<WebhookEndpoint>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectQueue(WEBHOOK_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  /** Returns the plaintext secret ONCE, at creation — never stored or re-servable, same "shown once" discipline as API keys, even though the storage mechanism differs (encrypted, not hashed). */
  async createWebhook(
    companyId: string,
    dto: CreateWebhookDto,
  ): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    validateWebhookUrl(dto.url);

    const existingCount = await this.endpointRepo.count({
      where: { companyId },
    });
    if (existingCount >= MAX_ENDPOINTS_PER_COMPANY) {
      throw new ForbiddenAppException(
        `You can have at most ${MAX_ENDPOINTS_PER_COMPANY} webhook endpoints`,
      );
    }

    const secret = generateWebhookSecret();
    const endpoint = this.endpointRepo.create({
      companyId,
      description: dto.description,
      url: dto.url,
      events: dto.events,
      secretEncrypted: encryptWebhookSecret(secret),
    });
    const saved = await this.endpointRepo.save(endpoint);
    return { endpoint: saved, secret };
  }

  async listForCompany(companyId: string): Promise<WebhookEndpoint[]> {
    return this.endpointRepo.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
    });
  }

  async updateWebhook(
    companyId: string,
    endpointId: string,
    dto: UpdateWebhookDto,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.getForCompany(companyId, endpointId);
    if (dto.url) validateWebhookUrl(dto.url);

    Object.assign(endpoint, dto);
    return this.endpointRepo.save(endpoint);
  }

  async deleteWebhook(companyId: string, endpointId: string): Promise<void> {
    const endpoint = await this.getForCompany(companyId, endpointId);
    await this.endpointRepo.remove(endpoint);
  }

  async listDeliveries(
    companyId: string,
    endpointId: string,
    query: ListWebhookDeliveriesQueryDto,
  ) {
    await this.getForCompany(companyId, endpointId); // ownership check
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.deliveryRepo
      .createQueryBuilder('d')
      .where('d.webhookEndpointId = :endpointId', { endpointId });

    if (query.status)
      qb.andWhere('d.status = :status', { status: query.status });

    qb.orderBy('d.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [deliveries, total] = await qb.getManyAndCount();
    return { deliveries, total, page, pageSize };
  }

  /** Re-enqueues a fresh delivery attempt for a past event — a new row, same eventId, incremented attemptNumber, so the delivery log shows the full retry history. */
  async retryDelivery(
    companyId: string,
    endpointId: string,
    deliveryId: string,
  ): Promise<void> {
    const endpoint = await this.getForCompany(companyId, endpointId);
    const original = await this.deliveryRepo.findOne({
      where: { id: deliveryId, webhookEndpointId: endpointId },
    });
    if (!original)
      throw new ResourceNotFoundException('Webhook delivery not found', );

    await this.queue.add(
      WebhookJobName.DELIVER,
      {
        webhookEndpointId: endpoint.id,
        eventId: original.eventId,
        eventType: original.eventType,
        payload: original.payload,
        attemptNumber: original.attemptNumber + 1,
      },
      { attempts: 1 }, // manual retry — no further auto-retry beyond this one explicit attempt
    );
  }

  /** Called by WebhooksDispatcherService, not exposed via controller — enqueues one delivery job per matching, active endpoint for a company. */
  async enqueueDeliveriesForEvent(
    companyId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const endpoints = await this.endpointRepo.find({
      where: { companyId, isActive: true },
    });
    const matching = endpoints.filter((e) => e.events.includes(eventType));
    if (matching.length === 0) return;

    const eventId = randomUUID();

    await Promise.all(
      matching.map((endpoint) =>
        this.queue.add(
          WebhookJobName.DELIVER,
          {
            webhookEndpointId: endpoint.id,
            eventId,
            eventType,
            payload,
            attemptNumber: 1,
          },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 30_000 }, // 30s, 1m, 2m, 4m, 8m — generous, since a receiver's downtime is often minutes, not seconds
            removeOnComplete: 200,
            removeOnFail: 500,
          },
        ),
      ),
    );
  }

  private async getForCompany(
    companyId: string,
    endpointId: string,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.endpointRepo.findOne({
      where: { id: endpointId },
    });
    if (!endpoint)
      throw new ResourceNotFoundException('Webhook endpoint cannot be found', );
    if (endpoint.companyId !== companyId)
      throw new ForbiddenAppException(
        'This webhook does not belong to your company',
      );
    return endpoint;
  }
}
