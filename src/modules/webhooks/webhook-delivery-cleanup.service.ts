import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { WebhookDelivery } from "#/common/entities/webhook-delivery.entity";

const RETENTION_DAYS = 30;
const BATCH_SIZE = 2000;
const MAX_EXECUTION_MS = 10 * 60 * 1000; // 10 minutes – stops if it takes longer

@Injectable()
export class WebhookDeliveryCleanupService {
  private readonly logger = new Logger(WebhookDeliveryCleanupService.name);
  private running = false; // prevent overlapping executions

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldDeliveries(): Promise<void> {
    // Avoid overlapping runs (safety net)
    if (this.running) {
      this.logger.warn("Previous cleanup job still running – skipping this cycle.");
      return;
    }

    this.running = true;
    const startTime = Date.now();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    let totalDeleted = 0;

    try {
      while (true) {
        // Enforce timeout – break out if we’re close to MAX_EXECUTION_MS
        if (Date.now() - startTime > MAX_EXECUTION_MS) {
          this.logger.warn(
            `Cleanup job exceeded ${MAX_EXECUTION_MS}ms – pausing until next run. Deleted ${totalDeleted} rows so far.`,
          );
          break;
        }

        // Safe batch: find IDs first, then delete (works on PostgreSQL)
        const batch = await this.deliveryRepo.find({
          where: { createdAt: LessThan(cutoff) },
          select: { id: true },
          take: BATCH_SIZE,
          order: { createdAt: "ASC" }, // oldest first
        });

        if (batch.length === 0) break;

        await this.deliveryRepo.delete(batch.map((row) => row.id));
        totalDeleted += batch.length;

        this.logger.debug(`Deleted batch of ${batch.length} old deliveries.`);
      }
    } catch (err) {
      this.logger.error(
        `Error while pruning webhook deliveries. Total deleted before failure: ${totalDeleted}`,
        (err as Error).stack,
      );
      // Continue – next run will handle remaining rows
    } finally {
      this.running = false;
    }

    if (totalDeleted > 0) {
      this.logger.log(
        `Pruned ${totalDeleted} webhook delivery log rows older than ${RETENTION_DAYS} days`,
      );
    }
  }
}