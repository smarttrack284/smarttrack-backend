import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import type { Queue } from "bullmq";
import { QueryFailedError, Repository } from "typeorm";
import { WebhookEndpoint } from "#/common/entities/webhook-endpoint.entity";
import { WebhookDelivery } from "#/common/entities/webhook-delivery.entity";
import { WebhookEventType } from "#/common/constants/webhook-event.constant";
import {
    encryptWebhookSecret,
    generateWebhookSecret
} from "#/common/utils/webhook-secret.util";
import { validateWebhookUrl } from "#/common/utils/webhook-url-validator.util";
import {
  BadRequestAppException,
    ForbiddenAppException,
    InternalErrorException,
    ResourceNotFoundException
} from "#/common/exceptions";
import {
    ErrorHandlerService,
    rule
} from "#/common/errors/error-handler.service";
import { CreateWebhookDto } from "./dto/create-webhook.dto";
import { UpdateWebhookDto } from "./dto/update-webhook.dto";
import { ListWebhookDeliveriesQueryDto } from "./dto/list-webhook-deliveries.query.dto";
import {
    WEBHOOK_QUEUE_NAME,
    WebhookJobName
} from "./constants/webhook-queue.constant";
import {
    resolveAndValidateWebhookHost,
    WebhookHostBlockedError
} from "#/common/utils/resolve-webhook-host.util";

const MAX_ENDPOINTS_PER_COMPANY = 5;

@Injectable()
export class WebhooksService {
    constructor(
        @InjectRepository(WebhookEndpoint)
        private readonly endpointRepo: Repository<WebhookEndpoint>,
        @InjectRepository(WebhookDelivery)
        private readonly deliveryRepo: Repository<WebhookDelivery>,
        @InjectQueue(WEBHOOK_QUEUE_NAME) private readonly queue: Queue,
        private readonly errorHandler: ErrorHandlerService
    ) {}

    /**
     * Creates a webhook endpoint and returns the plaintext secret once.
     * The encrypted secret is never exposed to the caller.
     */
    async createWebhook(
        companyId: string,
        dto: CreateWebhookDto
    ): Promise<{
        endpoint: Omit<WebhookEndpoint, "secretEncrypted">;
        secret: string;
    }> {
        try {
            // Static checks (protocol, port, credentials, blocked hostnames)
            validateWebhookUrl(dto.url);

            // Dynamic check – resolve the hostname right now and block any private/reserved IPs
            const hostname = new URL(dto.url).hostname;
            try {
                await resolveAndValidateWebhookHost(hostname);
            } catch (err) {
                if (err instanceof WebhookHostBlockedError) {
                    throw new BadRequestAppException(
                        "This URL points to a private or reserved address and cannot be used"
                    );
                }
                throw new BadRequestAppException(
                    "We could not resolve the hostname for this URL. Please check that it is correct."
                );
            }

            const existingCount = await this.endpointRepo.count({
                where: { companyId }
            });
            if (existingCount >= MAX_ENDPOINTS_PER_COMPANY) {
                throw new ForbiddenAppException(
                    `You can have at most ${MAX_ENDPOINTS_PER_COMPANY} webhook endpoints`
                );
            }

            const secret = generateWebhookSecret();
            const endpoint = this.endpointRepo.create({
                companyId,
                description: dto.description,
                url: dto.url,
                events: dto.events,
                secretEncrypted: encryptWebhookSecret(secret)
            });
            const saved = await this.endpointRepo.save(endpoint);

            // Strip the encrypted secret from the returned object
            const { secretEncrypted, ...safeEndpoint } = saved;
            return { endpoint: safeEndpoint, secret };
        } catch (err) {
            this.errorHandler.handle(err, "WebhooksService.createWebhook", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to create webhook endpoint. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async listForCompany(companyId: string): Promise<WebhookEndpoint[]> {
        try {
            return this.endpointRepo.find({
                where: { companyId },
                order: { createdAt: "DESC" },
                select: {
                    id: true,
                    description: true,
                    url: true,
                    events: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true
                }
            });
        } catch (err) {
            this.errorHandler.handle(err, "WebhooksService.listForCompany", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to list webhooks. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async updateWebhook(
        companyId: string,
        endpointId: string,
        dto: UpdateWebhookDto
    ): Promise<{
        id: string;
        description: string;
        url: string;
        events: WebhookEventType[];
        isActive: boolean;
        createdAt: string;
    }> {
        try {
            const endpoint = await this.getForCompany(companyId, endpointId);
            if (dto.url) validateWebhookUrl(dto.url);

            Object.assign(endpoint, dto);

            const saved = await this.endpointRepo.save(endpoint);
            return {
                id: saved.id,
                description: saved.description,
                url: saved.url,
                events: saved.events,
                isActive: saved.isActive,
                createdAt: saved.createdAt.toISOString()
            };
        } catch (err) {
            this.errorHandler.handle(err, "WebhooksService.updateWebhook", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to update webhook. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async deleteWebhook(companyId: string, endpointId: string): Promise<void> {
        try {
            const endpoint = await this.getForCompany(companyId, endpointId);
            await this.endpointRepo.remove(endpoint);
        } catch (err) {
            this.errorHandler.handle(err, "WebhooksService.deleteWebhook", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to delete webhook. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async listDeliveries(
        companyId: string,
        endpointId: string,
        query: ListWebhookDeliveriesQueryDto
    ) {
        try {
            await this.getForCompany(companyId, endpointId); // ownership check
            const page = query.page ?? 1;
            const pageSize = query.pageSize ?? 20;

            const qb = this.deliveryRepo
                .createQueryBuilder("d")
                .where("d.webhookEndpointId = :endpointId", { endpointId });

            if (query.status)
                qb.andWhere("d.status = :status", { status: query.status });

            qb.orderBy("d.createdAt", "DESC")
                .skip((page - 1) * pageSize)
                .take(pageSize);

            const [deliveries, total] = await qb.getManyAndCount();
            return { deliveries, total, page, pageSize };
        } catch (err) {
            this.errorHandler.handle(err, "WebhooksService.listDeliveries", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to list webhook deliveries. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async retryDelivery(
        companyId: string,
        endpointId: string,
        deliveryId: string
    ): Promise<void> {
        try {
            const endpoint = await this.getForCompany(companyId, endpointId);
            const original = await this.deliveryRepo.findOne({
                where: { id: deliveryId, webhookEndpointId: endpointId }
            });
            if (!original)
                throw new ResourceNotFoundException(
                    "Webhook delivery not found"
                );

            await this.queue.add(
                WebhookJobName.DELIVER,
                {
                    webhookEndpointId: endpoint.id,
                    eventId: original.eventId,
                    eventType: original.eventType,
                    payload: original.payload,
                    attemptNumber: original.attemptNumber + 1
                },
                { attempts: 1 }
            );
        } catch (err) {
            this.errorHandler.handle(err, "WebhooksService.retryDelivery", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to retry delivery. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async enqueueDeliveriesForEvent(
        companyId: string,
        eventType: WebhookEventType,
        payload: Record<string, unknown>
    ): Promise<void> {
        try {
            const endpoints = await this.endpointRepo.find({
                where: { companyId, isActive: true }
            });
            const matching = endpoints.filter(e =>
                e.events.includes(eventType)
            );
            if (matching.length === 0) return;

            const eventId = randomUUID();

            await Promise.all(
                matching.map(endpoint =>
                    this.queue.add(
                        WebhookJobName.DELIVER,
                        {
                            webhookEndpointId: endpoint.id,
                            eventId,
                            eventType,
                            payload,
                            attemptNumber: 1
                        },
                        {
                            attempts: 5,
                            backoff: { type: "exponential", delay: 30_000 },
                            removeOnComplete: 200,
                            removeOnFail: 500
                        }
                    )
                )
            );
        } catch (err) {
            // This is a fire‑and‑forget internal method – we must not crash the event loop.
            // Log the error but never rethrow.
            this.errorHandler.handle(
                err,
                "WebhooksService.enqueueDeliveriesForEvent",
                [
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "Failed to enqueue webhook deliveries. Check logs for details."
                            )
                    )
                ]
            );
        }
    }

    private async getForCompany(
        companyId: string,
        endpointId: string
    ): Promise<WebhookEndpoint> {
        try {
            const endpoint = await this.endpointRepo.findOne({
                where: { id: endpointId }
            });
            if (!endpoint)
                throw new ResourceNotFoundException(
                    "Webhook endpoint cannot be found"
                );
            if (endpoint.companyId !== companyId)
                throw new ForbiddenAppException(
                    "This webhook does not belong to your company"
                );
            return endpoint;
        } catch (err) {
            // Re‑throw known exceptions, map unknown DB errors to internal
            if (
                err instanceof ResourceNotFoundException ||
                err instanceof ForbiddenAppException
            ) {
                throw err;
            }
            throw new InternalErrorException(
                "Unable to retrieve webhook endpoint. Please try again."
            );
        }
    }
}
