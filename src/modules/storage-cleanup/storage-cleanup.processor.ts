import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { StorageService } from "#/common/storage/storage.service";
import { StorageCleanupService } from "./storage-cleanup.service";
import {
    STORAGE_CLEANUP_QUEUE_NAME,
    StorageCleanupJobName,
    DeleteObjectJobData,
    ReconcilePrefixJobData,
    DeleteFolderJobData
} from "#/common/constants/storage-cleanup-queue.constant";
("#/common/constants/storage-cleanup-queue.constant");

@Processor(STORAGE_CLEANUP_QUEUE_NAME, { concurrency: 5 })
export class StorageCleanupProcessor extends WorkerHost {
    private readonly logger = new Logger(StorageCleanupProcessor.name);

    constructor(
        private readonly storageService: StorageService,
        private readonly storageCleanupService: StorageCleanupService
    ) {
        super();
    }

    async process(job: Job): Promise<void> {
        if (job.name === StorageCleanupJobName.DELETE_OBJECT) {
            await this.handleDelete(job);
        } else if (job.name === StorageCleanupJobName.DELETE_FOLDER) {
            await this.handleDeleteFolder(job);
        } else if (job.name === StorageCleanupJobName.RECONCILE_PREFIX) {
            await this.handleReconcile(job);
        }
    }

    private async handleDelete(job: Job<DeleteObjectJobData>) {
        const { path, reason } = job.data;
        try {
            await this.storageService.deleteFile(path);
            this.logger.log({
                msg: "Deleted storage object",
                path,
                reason
            });
        } catch (err) {
            this.logger.error({
                msg: "Failed to delete storage object (will retry)",
                path,
                reason,
                err: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }

    private async handleReconcile(job: Job<ReconcilePrefixJobData>) {
        const { prefix } = job.data;
        try {
            const orphanedFiles =
                await this.storageCleanupService.findOrphanedFilesForPrefix(
                    prefix
                );

            if (orphanedFiles.length === 0) {
                this.logger.log({
                    msg: "No orphaned files found",
                    prefix
                });
                return;
            }

            this.logger.warn({
                msg: "Found orphaned files, enqueuing deletion",
                prefix,
                count: orphanedFiles.length
            });

            for (const path of orphanedFiles) {
                await this.storageCleanupService.enqueueDelete(
                    path,
                    `reconciliation:${prefix}`
                );
            }
        } catch (err) {
            this.logger.error({
                msg: "Reconciliation scan failed",
                prefix,
                err: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }

    private async handleDeleteFolder(job: Job<DeleteFolderJobData>) {
        const { prefix, reason } = job.data;
        try {
            await this.storageService.deleteFolder(prefix);
            this.logger.log({
                msg: "Deleted storage folder",
                prefix,
                reason
            });
        } catch (err) {
            this.logger.error({
                msg: "Failed to delete storage folder (will retry)",
                prefix,
                reason,
                err: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }
}
