import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { StorageCleanupService } from "./storage-cleanup.service";

/**
 * Scheduled reconciliation for storage cleanup.
 * Ensures that orphaned files (e.g., avatars uploaded but never referenced)
 * are periodically discovered and enqueued for deletion.
 *
 * Runs daily at 3:00 AM by default.
 */
@Injectable()
export class StorageCleanupReconciliationService {
    private readonly logger = new Logger(
        StorageCleanupReconciliationService.name
    );

    // Prefixes that are known to contain user-uploaded files.
    // Add new prefixes here as new file features are built.
    private static readonly KNOWN_PREFIXES = ['admin/avatars', 'companies'];

    constructor(
        private readonly storageCleanupService: StorageCleanupService
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async reconcileKnownPrefixes(): Promise<void> {
        this.logger.log("Starting scheduled storage cleanup reconciliation...");

        for (const prefix of StorageCleanupReconciliationService.KNOWN_PREFIXES) {
            try {
                await this.storageCleanupService.enqueueReconcile(prefix);
                this.logger.log({
                    msg: "Enqueued reconciliation scan",
                    prefix
                });
            } catch (err) {
                this.logger.error({
                    msg: "Failed to enqueue reconciliation scan",
                    prefix,
                    err: err instanceof Error ? err.message : String(err)
                });
            }
        }
    }
}
