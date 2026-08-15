import { Module, Global } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StorageCleanupService } from "./storage-cleanup.service";
import { StorageCleanupProcessor } from "./storage-cleanup.processor";
import { StorageCleanupReconciliationService } from "./storage-cleanup-reconciliation.service";
import { AdminUser } from "#/common/entities/admin-user.entity";
import { STORAGE_CLEANUP_QUEUE_NAME } from "#/common/constants/storage-cleanup-queue.constant";

@Global()
@Module({
    imports: [
        BullModule.registerQueue({
            name: STORAGE_CLEANUP_QUEUE_NAME,
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: 1000
            }
        }),
        TypeOrmModule.forFeature([AdminUser])
    ],
    providers: [
        StorageCleanupService,
        StorageCleanupProcessor,
        StorageCleanupReconciliationService
    ],
    exports: [StorageCleanupService]
})
export class StorageCleanupModule {}
