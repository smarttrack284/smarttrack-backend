import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { WebhookDelivery } from '#/common/entities/webhook-delivery.entity';

const RETENTION_DAYS = 30;

/**
 * Runs once daily. Deletes delivery log rows older than RETENTION_DAYS —
 * these are an operational audit trail (for the "delivery history" UI
 * and manual retry), not billing/compliance records, so a rolling window
 * is the right model rather than keeping them forever. 30 days is a
 * reasonable default for "did my integration miss something recently";
 */
@Injectable()
export class WebhookDeliveryCleanupService {
  private readonly logger = new Logger(WebhookDeliveryCleanupService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldDeliveries(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);

    // Deleted in batches, not one unbounded DELETE — a single huge delete
    // on a large table can hold a long-running lock and bloat the
    // transaction log. Looping in chunks keeps each transaction small.
    let totalDeleted = 0;
    while (true) {
      const batch = await this.deliveryRepo.find({
        where: { createdAt: LessThan(cutoff) },
        select: {'id': true},
        take: 1000,
      });
      if (batch.length === 0) break;

      await this.deliveryRepo.delete(batch.map((row) => row.id));
      totalDeleted += batch.length;
    }

    if (totalDeleted > 0) {
      this.logger.log(
        `Pruned ${totalDeleted} webhook delivery log rows older than ${RETENTION_DAYS} days`,
      );
    }
  }
}
